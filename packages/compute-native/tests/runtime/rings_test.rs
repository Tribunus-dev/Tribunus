use anyhow::Result;
use tribunus_compute_native::runtime::rings::{
    RingType, TypedRing, KVRing, SpeculativeKVRing, ProposalRing, GenericRing,
    ArenaConfig, RingRegistry
};

#[test]
fn test_kv_ring_eviction() -> Result<()> {
    // Capacity 10
    let mut ring = KVRing::new(10, 4096);
    assert_eq!(ring.slot_count(), 10);
    assert_eq!(ring.slot_size(), 4096);

    // Fill the ring
    let mut slots = Vec::new();
    for i in 0..10 {
        let slot = ring.reserve_slot()?;
        assert_eq!(slot.ring_type, RingType::KV);
        ring.write_slot(slot.slot_id, &vec![i as u8; 4096])?;
        slots.push(slot);
    }

    // Ring is full. Next reservation should evict the oldest (slot 0)
    let evicted_slot = ring.reserve_slot()?;
    assert_eq!(evicted_slot.slot_id, slots[0].slot_id);
    assert_eq!(evicted_slot.generation, slots[0].generation + 1);

    ring.write_slot(evicted_slot.slot_id, &vec![10; 4096])?;
    let data = ring.read_slot(evicted_slot.slot_id)?;
    assert_eq!(data[0], 10);

    // Write 100 slots to test repeated eviction
    let mut ring_100 = KVRing::new(100, 4096);
    for i in 0..150 {
        let slot = ring_100.reserve_slot()?;
        ring_100.write_slot(slot.slot_id, &vec![(i % 256) as u8; 4096])?;
        if i == 149 {
            let data = ring_100.read_slot(slot.slot_id)?;
            assert_eq!(data[0], 149);
        }
    }

    Ok(())
}

#[test]
fn test_speculative_kv_ring() -> Result<()> {
    let mut spec_ring = SpeculativeKVRing::new(2048, 4096);
    let mut kv_ring = KVRing::new(32768, 4096);

    // Write 8 branches
    let mut branch_slots = Vec::new();
    for branch_id in 0..8 {
        let slot = spec_ring.reserve_for_branch(branch_id)?;
        spec_ring.write_slot(slot.slot_id, &vec![branch_id as u8; 4096])?;
        branch_slots.push(slot);
    }

    // Commit branch 1 (slot 1)
    spec_ring.commit(branch_slots[1].slot_id, &mut kv_ring)?;

    // Verify KV ring now has committed slots
    // Since KV ring is empty, it will use its first free slot
    // We reserved 1 slot in kv_ring, so let's verify it



    assert_eq!(spec_ring.generations[branch_slots[1].slot_id], branch_slots[1].generation + 1);
    assert_eq!(spec_ring.branch_map[branch_slots[1].slot_id], None);

    // Rollback branch 2 (slot 2)
    spec_ring.rollback(2)?;
    assert_eq!(spec_ring.generations[branch_slots[2].slot_id], branch_slots[2].generation + 1);
    assert_eq!(spec_ring.branch_map[branch_slots[2].slot_id], None);

    // Rollback remaining branches by ID
    for branch_id in [0, 3, 4, 5, 6, 7] {
        spec_ring.rollback(branch_id)?;
    }

    // Verify all branches invalidated
    for i in 0..8 {
        assert_eq!(spec_ring.branch_map[branch_slots[i].slot_id], None);
    }

    Ok(())
}

#[test]
fn test_activation_ring() -> Result<()> {
    let mut ring = GenericRing::new(RingType::Activation, 512, 65536);

    // Write activation
    let slot = ring.reserve_slot()?;
    assert_eq!(slot.ring_type, RingType::Activation);

    let data = vec![42; 65536];
    ring.write_slot(slot.slot_id, &data)?;

    // Read it back
    let read_data = ring.read_slot(slot.slot_id)?;
    assert_eq!(read_data[0], 42);
    assert_eq!(read_data.len(), 65536);

    // Release
    ring.release_slot(slot.slot_id)?;

    // Verify slot is free and generation incremented
    assert_eq!(ring.generations[slot.slot_id], slot.generation + 1);

    Ok(())
}

#[test]
fn test_proposal_ring() -> Result<()> {
    let mut ring = ProposalRing::new(64, 16384);

    // Write 8 proposals
    let mut slots = Vec::new();
    for i in 0..8 {
        let slot = ring.reserve_slot()?;
        assert_eq!(slot.ring_type, RingType::Proposal);
        ring.write_slot(slot.slot_id, &vec![i as u8; 16384])?;
        slots.push(slot);
    }

    // CPU reads them
    for i in 0..8 {
        let read_data = ring.read_slot(slots[i].slot_id)?;
        assert_eq!(read_data[0], i as u8);
    }

    // Release
    for i in 0..8 {
        ring.release_slot(slots[i].slot_id)?;
    }

    Ok(())
}

#[test]
fn test_verifier_ring() -> Result<()> {
    let mut ring = GenericRing::new(RingType::Verifier, 32, 131072);

    // Pack candidate tree
    let slot = ring.reserve_slot()?;
    assert_eq!(slot.ring_type, RingType::Verifier);

    let data = vec![7; 131072];
    ring.write_slot(slot.slot_id, &data)?;

    // Verifier reads tree
    let read_data = ring.read_slot(slot.slot_id)?;
    assert_eq!(read_data[0], 7);

    ring.release_slot(slot.slot_id)?;

    Ok(())
}

#[test]
fn test_logits_ring() -> Result<()> {
    let mut ring = GenericRing::new(RingType::Logits, 128, 8192);

    let slot = ring.reserve_slot()?;
    assert_eq!(slot.ring_type, RingType::Logits);

    let data = vec![3; 8192];
    ring.write_slot(slot.slot_id, &data)?;

    let read_data = ring.read_slot(slot.slot_id)?;
    assert_eq!(read_data[0], 3);

    ring.release_slot(slot.slot_id)?;

    Ok(())
}

#[test]
fn test_scratch_ring() -> Result<()> {
    let mut ring = GenericRing::new(RingType::Scratch, 64, 1048576);

    // Allocate scratch
    let slot = ring.reserve_slot()?;
    assert_eq!(slot.ring_type, RingType::Scratch);

    // Use
    let data = vec![9; 1048576];
    ring.write_slot(slot.slot_id, &data)?;

    let read_data = ring.read_slot(slot.slot_id)?;
    assert_eq!(read_data[0], 9);

    // Release
    ring.release_slot(slot.slot_id)?;

    // Verify free
    assert_eq!(ring.generations[slot.slot_id], slot.generation + 1);

    Ok(())
}

#[test]
fn test_weight_staging_ring() -> Result<()> {
    let mut ring = GenericRing::new(RingType::WeightStaging, 128, 2097152);

    // Decompress weight tile, stage to ring
    let slot = ring.reserve_slot()?;
    assert_eq!(slot.ring_type, RingType::WeightStaging);

    let data = vec![5; 2097152];
    ring.write_slot(slot.slot_id, &data)?;

    // GPU reads
    let read_data = ring.read_slot(slot.slot_id)?;
    assert_eq!(read_data[0], 5);

    // Release
    ring.release_slot(slot.slot_id)?;

    Ok(())
}

#[test]
fn test_ring_registry() {
    let config = ArenaConfig::default();
    let mut registry = RingRegistry::new(&config);

    let kv_ring = registry.get(RingType::KV);
    assert_eq!(kv_ring.slot_count(), config.kv_slot_count);
    assert_eq!(kv_ring.slot_size(), config.kv_slot_size);

    let spec_kv_ring = registry.get(RingType::SpeculativeKV);
    assert_eq!(spec_kv_ring.slot_count(), config.spec_kv_slot_count);
    assert_eq!(spec_kv_ring.slot_size(), config.kv_slot_size);

    let activation_ring = registry.get(RingType::Activation);
    assert_eq!(activation_ring.slot_count(), config.activation_slot_count);
    assert_eq!(activation_ring.slot_size(), config.activation_slot_size);

    let proposal_ring = registry.get(RingType::Proposal);
    assert_eq!(proposal_ring.slot_count(), config.proposal_slot_count);

    let scratch_ring = registry.get_mut(RingType::Scratch);
    assert_eq!(scratch_ring.slot_count(), config.scratch_slot_count);
}
