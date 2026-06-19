
use tribunus_compute_native::runtime::{ArenaPage, DataType, ResidencyTier, RingSlot, SlotState};
use tribunus_compute_native::decode_attribution::backend_adapters::BackendKind;

#[test]
fn test_arena_page_alloc_and_fill() {
    let mut page = ArenaPage::new(1024, DataType::F32, 64, ResidencyTier::Host).unwrap();
    assert_eq!(page.byte_len, 1024);
    assert_eq!(page.alignment, 64);
    assert_eq!(page.dtype, DataType::F32);
    assert_eq!(page.residency_tier, ResidencyTier::Host);

    page.fill(42);
    let slice = page.slice(0, 1024).unwrap();
    assert!(slice.iter().all(|&x| x == 42));

    page.zero();
    let slice = page.slice(0, 1024).unwrap();
    assert!(slice.iter().all(|&x| x == 0));
}

#[test]
fn test_arena_page_copy() {
    let mut page = ArenaPage::new(1024, DataType::F32, 64, ResidencyTier::Host).unwrap();
    let src = vec![1, 2, 3, 4];
    page.copy_from(&src, 10).unwrap();

    let mut dst = vec![0; 4];
    page.copy_to(&mut dst, 10).unwrap();

    assert_eq!(src, dst);
}

#[test]
fn test_ring_slot_state_machine() {
    let mut slot = RingSlot::new();
    assert!(matches!(slot.state, SlotState::Free));

    slot.transition(SlotState::Reserved).unwrap();
    assert!(matches!(slot.state, SlotState::Reserved));

    slot.transition(SlotState::Writing { backend: BackendKind::Mlx }).unwrap();
    assert!(matches!(slot.state, SlotState::Writing { .. }));

    slot.transition(SlotState::Written).unwrap();
    slot.transition(SlotState::Readable).unwrap();
    slot.transition(SlotState::Verifying).unwrap();
    slot.transition(SlotState::Committed).unwrap();
    slot.transition(SlotState::Recycled).unwrap();
    slot.transition(SlotState::Free).unwrap();
}

#[test]
fn test_ring_slot_illegal_transition() {
    let mut slot = RingSlot::new();
    assert!(matches!(slot.state, SlotState::Free));

    let result = slot.transition(SlotState::Verifying);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("Cannot transition from Free to Verifying"));
}

#[test]
fn test_ring_slot_generation_invalidation() {
    let mut slot = RingSlot::new();
    let gen = slot.generation;
    assert!(slot.is_valid(gen));

    slot.invalidate();
    assert!(!slot.is_valid(gen));
    assert!(matches!(slot.state, SlotState::GenerationInvalidated));
    assert_eq!(slot.generation, gen + 1);
}