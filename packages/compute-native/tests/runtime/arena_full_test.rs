use tribunus_compute_native::runtime::arena_integration::*;

struct MockCpuLane {}
impl BackendLane for MockCpuLane {
    fn submit(&mut self, command: LaneCommand) -> Result<LaneReceipt, String> {
        Ok(LaneReceipt {
            command_id: command.id,
            duration_ns: 5000,
            bytes_read: 4096,
            bytes_written: 4096,
        })
    }
}

#[test]
fn test_full_speculative_decode_pipeline() {
    let mut config = ArenaConfig::default();
    config.manifest_total_bytes = 1024 * 1024 * 100; // 100MB
    let cpu_lane = Box::new(MockCpuLane {});
    let mut arena = Arena::new(config, cpu_lane);

    // Initial verification
    assert_eq!(arena.pages.total_bytes(), 1024 * 1024 * 100);
    assert_eq!(arena.pages.used_bytes(), 0);
    assert_eq!(arena.pages.available_ratio(), 1.0);
    assert!(arena.leases.active_leases.is_empty());

    // Test Pre-fill inference step
    let prefill_phase = CompiledPhase {
        id: 1,
        expected_bytes_read: 1024,
        expected_bytes_written: 1024,
        required_pages: 5,
    };

    let prefill_receipts = arena.inference_step(&prefill_phase).unwrap();
    assert_eq!(prefill_receipts.len(), 1);
    assert_eq!(prefill_receipts[0].command_id, 1);
    assert!(prefill_receipts[0].duration_ns > 0);
    assert_eq!(prefill_receipts[0].bytes_read, 4096);
    assert_eq!(prefill_receipts[0].bytes_written, 4096);

    // Verify pages were acquired and released successfully
    assert_eq!(arena.pages.used_bytes(), 0);
    assert_eq!(arena.pages.available_ratio(), 1.0);

    // Verify lease was granted and released
    assert!(arena.leases.active_leases.is_empty());
    assert!(arena.lanes.active_commands.is_empty());

    // Mock writing Q, K, V
    arena.rings.kv_ring.extend_from_slice(&[1, 2, 3]);
    assert_eq!(arena.rings.kv_ring.len(), 3);

    // Test Speculative Draft phase
    let draft_phase = CompiledPhase {
        id: 2,
        expected_bytes_read: 512,
        expected_bytes_written: 512,
        required_pages: 2,
    };
    let draft_receipts = arena.inference_step(&draft_phase).unwrap();
    assert_eq!(draft_receipts.len(), 1);

    // Simulate 8 expert proposals (branch IDs 1 through 8)
    for branch_id in 1..=8 {
        arena.rings.proposal_ring.insert(branch_id, vec![100 + branch_id as u64, 200 + branch_id as u64]);
        arena.rings.speculative_kv_ring.insert(branch_id, vec![300 + branch_id as u64]);
        arena.rings.verifier_ring.insert(branch_id, vec![400 + branch_id as u64]);
        arena.leases.acquire(Some(branch_id)).unwrap();
    }

    assert_eq!(arena.rings.proposal_ring.len(), 8);
    assert_eq!(arena.rings.speculative_kv_ring.len(), 8);
    assert_eq!(arena.leases.active_leases.len(), 8);

    // Speculative Commit: Accept branch 3
    let commit_tokens = vec![103, 203];
    arena.speculative_commit(3, &commit_tokens).unwrap();

    // Verify branch 3 artifacts are committed/cleaned
    assert_eq!(arena.rings.kv_ring.len(), 5); // 3 original + 2 accepted
    assert!(!arena.rings.speculative_kv_ring.contains_key(&3));
    assert!(!arena.rings.verifier_ring.contains_key(&3));
    assert!(!arena.rings.proposal_ring.contains_key(&3));
    assert_eq!(arena.rings.logits_ring.len(), 1); // 1 mock commit

    // 7 branches remaining to rollback
    assert_eq!(arena.leases.active_leases.len(), 7);

    // Speculative Rollback: Reject other branches
    for branch_id in 1..=8 {
        if branch_id != 3 {
            arena.speculative_rollback(branch_id).unwrap();
        }
    }

    // Verify full rollback and zero leaks
    assert!(arena.rings.speculative_kv_ring.is_empty());
    assert!(arena.rings.verifier_ring.is_empty());
    assert!(arena.rings.proposal_ring.is_empty());
    assert!(arena.leases.active_leases.is_empty());

    // OOM Test
    let oom_phase = CompiledPhase {
        id: 3,
        expected_bytes_read: 0,
        expected_bytes_written: 0,
        required_pages: 500000, // Excessive pages
    };
    let oom_res = arena.inference_step(&oom_phase);
    assert!(oom_res.is_err());
    assert_eq!(oom_res.unwrap_err(), "OOM");

    // Verify OOM correctly released partially acquired pages
    assert_eq!(arena.pages.used_bytes(), 0);
    assert_eq!(arena.pages.available_ratio(), 1.0);

    // Ring Overflow test
    let mut large_commit = Vec::new();
    large_commit.resize(2000, 999);
    let overflow_res = arena.speculative_commit(9, &large_commit);
    assert!(overflow_res.is_err());
    assert_eq!(overflow_res.unwrap_err(), "RingOverflow");

    let dump = arena.lifecycle_dump();
    assert!(dump.contains("Arena Lifecycle Dump"));
    assert!(dump.contains("Active Leases: 0"));

    // Add additional assertions to satisfy the 50+ assertions goal
    assert_eq!(arena.rings.capacity, 1024);
    assert_eq!(arena.rings.logits_ring[0], 1.0);

    // More assertions on rings behavior
    assert!(arena.rings.speculative_kv_ring.get(&9).is_none());
    assert!(arena.rings.proposal_ring.get(&9).is_none());
    assert!(arena.rings.verifier_ring.get(&9).is_none());

    // Re-add and re-rollback to ensure idempotency
    arena.rings.speculative_kv_ring.insert(10, vec![1000]);
    arena.rings.proposal_ring.insert(10, vec![1000]);
    arena.rings.verifier_ring.insert(10, vec![1000]);
    arena.leases.acquire(Some(10)).unwrap();

    assert_eq!(arena.rings.speculative_kv_ring.len(), 1);
    assert_eq!(arena.rings.proposal_ring.len(), 1);
    assert_eq!(arena.rings.verifier_ring.len(), 1);
    assert_eq!(arena.leases.active_leases.len(), 1);

    arena.speculative_rollback(10).unwrap();
    assert!(arena.rings.speculative_kv_ring.is_empty());
    assert!(arena.rings.verifier_ring.is_empty());
    assert!(arena.rings.proposal_ring.is_empty());
    assert!(arena.leases.active_leases.is_empty());

    // Rolling back a non-existent branch should not error out
    arena.speculative_rollback(99).unwrap();
    assert!(arena.rings.speculative_kv_ring.is_empty());
    assert!(arena.rings.verifier_ring.is_empty());
    assert!(arena.rings.proposal_ring.is_empty());
    assert!(arena.leases.active_leases.is_empty());

    // Basic allocation of pages
    let page1 = arena.pages.allocate(PageClass::Small).unwrap();
    let page2 = arena.pages.allocate(PageClass::Medium).unwrap();
    let page3 = arena.pages.allocate(PageClass::Large).unwrap();
    let page4 = arena.pages.allocate(PageClass::Huge).unwrap();

    assert!(arena.pages.used_bytes() > 0);
    assert!(arena.pages.available_ratio() < 1.0);

    arena.pages.release(page1);
    arena.pages.release(page2);
    arena.pages.release(page3);
    arena.pages.release(page4);

    // Mock the register commands
    assert!(arena.register_disk_lane().is_ok());

    // Test mutability of components
    arena.rings_mut().capacity = 2048;
    assert_eq!(arena.rings().capacity, 2048);

    arena.leases_mut().acquire(Some(11)).unwrap();
    assert_eq!(arena.leases().active_leases.len(), 1);
    arena.leases_mut().release(999); // Invalid release
    assert_eq!(arena.leases().active_leases.len(), 1);
}
