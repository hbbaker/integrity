//! A small seeded random generator (SplitMix64). The same seed always gives the
//! same sequence, which is what makes a generated map reproducible and testable.

#[derive(Debug, Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng { state: seed }
    }

    /// A new generator whose sequence depends on this seed and `salt`, for independent streams.
    pub fn derive(seed: u64, salt: u64) -> Self {
        let mut mixer = Rng::new(seed ^ salt.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        Rng::new(mixer.next_u64())
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        value ^ (value >> 31)
    }

    /// A whole number in `low..=high`.
    pub fn range(&mut self, low: i32, high: i32) -> i32 {
        assert!(low <= high, "empty range");
        let span = (i64::from(high) - i64::from(low) + 1) as u64;
        low + (self.next_u64() % span) as i32
    }

    /// True with probability `p` (0.0 to 1.0).
    pub fn chance(&mut self, p: f64) -> bool {
        ((self.next_u64() >> 11) as f64 / (1u64 << 53) as f64) < p
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_repeat_the_sequence_when_seeded_the_same() {
        let (mut a, mut b) = (Rng::new(7), Rng::new(7));
        assert!((0..20).all(|_| a.next_u64() == b.next_u64()));
    }

    #[test]
    fn should_differ_when_seeded_differently() {
        assert_ne!(Rng::new(1).next_u64(), Rng::new(2).next_u64());
        assert_ne!(Rng::derive(1, 1).next_u64(), Rng::derive(1, 2).next_u64());
    }

    #[test]
    fn should_stay_inside_the_bounds_when_drawing_a_range() {
        let mut rng = Rng::new(99);
        for _ in 0..1000 {
            let value = rng.range(-3, 5);
            assert!((-3..=5).contains(&value));
        }
        assert_eq!(rng.range(4, 4), 4);
    }

    #[test]
    fn should_hit_every_value_in_a_small_range() {
        let mut rng = Rng::new(5);
        let seen: std::collections::HashSet<i32> = (0..200).map(|_| rng.range(0, 3)).collect();
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn should_follow_the_probability_when_drawing_chances() {
        let mut rng = Rng::new(3);
        let hits = (0..10_000).filter(|_| rng.chance(0.8)).count();
        assert!((7600..8400).contains(&hits), "{hits} hits out of 10000");
        assert!(!rng.chance(0.0));
        assert!(rng.chance(1.0));
    }
}
