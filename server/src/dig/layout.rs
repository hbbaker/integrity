//! Site generation: `generate(seed)` returns the same layout for the same seed.
//!
//! The site is a 48 x 48 tile grid (one tile = one metre) with a street across the
//! middle and 2 or 3 houses on each side, so 4 to 6 lots in all. Every buried line
//! is implied by surface indicators:
//!   hydrants         mark a water main            water meters  mark a water service
//!   power poles      mark an electric main        vaults        mark a point on it
//!   dogboxes         mark a telecom line          gas meters    mark a gas service
//!   gas markers      mark a gas main              manholes      mark the sewer main
//!   drains           mark a sewer lateral
//! Each line gets a depth for every tile, inside the range for its type, changing
//! gently along the route. Where two lines share a tile their depths differ by at
//! least `MIN_SEPARATION` inches, so crossings are always at different depths.

use std::collections::HashMap;

use crate::rng::Rng;

pub const WIDTH: i32 = 48;
pub const HEIGHT: i32 = 48;

/// Closest two lines may be, in inches, where they share a tile.
pub const MIN_SEPARATION: i32 = 12;
/// Most a line's depth may change from one tile to the next, in inches.
pub const MAX_SLOPE_PER_TILE: i32 = 6;
/// Indicators must sit this close (in tiles, either axis) to a line they imply.
pub const INDICATOR_REACH: i32 = 2;

const MAX_ATTEMPTS: u64 = 64;
const MAX_RELAX_PASSES: usize = 80;

pub type Tile = (i32, i32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UtilityKind {
    Electric,
    Gas,
    Water,
    Telecom,
    Sewer,
}

impl UtilityKind {
    /// Realistic burial depth range in inches (to the top of the pipe).
    pub fn depth_range(self) -> (i32, i32) {
        match self {
            UtilityKind::Telecom => (12, 24),
            UtilityKind::Gas => (18, 36),
            UtilityKind::Electric => (24, 48),
            UtilityKind::Water => (36, 60),
            UtilityKind::Sewer => (48, 120),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            UtilityKind::Electric => "electric",
            UtilityKind::Gas => "gas",
            UtilityKind::Water => "water",
            UtilityKind::Telecom => "telecom",
            UtilityKind::Sewer => "sewer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndicatorKind {
    PowerPole,
    Vault,
    Dogbox,
    WaterMeter,
    Hydrant,
    GasMeter,
    GasMarker,
    Manhole,
    Drain,
}

impl IndicatorKind {
    pub fn name(self) -> &'static str {
        match self {
            IndicatorKind::PowerPole => "pole",
            IndicatorKind::Vault => "vault",
            IndicatorKind::Dogbox => "dogbox",
            IndicatorKind::WaterMeter => "water_meter",
            IndicatorKind::Hydrant => "hydrant",
            IndicatorKind::GasMeter => "gas_meter",
            IndicatorKind::GasMarker => "gas_marker",
            IndicatorKind::Manhole => "manhole",
            IndicatorKind::Drain => "drain",
        }
    }

    /// The utility this kind of indicator can imply.
    pub fn utility(self) -> UtilityKind {
        match self {
            IndicatorKind::PowerPole | IndicatorKind::Vault => UtilityKind::Electric,
            IndicatorKind::Dogbox => UtilityKind::Telecom,
            IndicatorKind::WaterMeter | IndicatorKind::Hydrant => UtilityKind::Water,
            IndicatorKind::GasMeter | IndicatorKind::GasMarker => UtilityKind::Gas,
            IndicatorKind::Manhole | IndicatorKind::Drain => UtilityKind::Sewer,
        }
    }
}

/// An inclusive rectangle of tiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x0: i32,
    pub z0: i32,
    pub x1: i32,
    pub z1: i32,
}

impl Rect {
    pub fn contains(&self, (x, z): Tile) -> bool {
        (self.x0..=self.x1).contains(&x) && (self.z0..=self.z1).contains(&z)
    }
}

#[derive(Debug, Clone)]
pub struct Building {
    pub rect: Rect,
    /// True when the front door faces the larger-z side (the north houses face south, toward the street).
    pub faces_larger_z: bool,
}

#[derive(Debug, Clone)]
pub struct Indicator {
    pub id: usize,
    pub kind: IndicatorKind,
    pub tile: Tile,
    /// Indices into `Layout::lines` that this indicator implies. Never sent to clients.
    pub lines: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct Line {
    pub kind: UtilityKind,
    pub tiles: Vec<Tile>,
    /// Depth in inches at each tile, same length as `tiles`.
    pub depths: Vec<i32>,
}

#[derive(Debug, Clone)]
pub struct Layout {
    /// The seed this layout came from: kept so a match can be reproduced when debugging.
    #[allow(dead_code)]
    pub seed: u64,
    pub buildings: Vec<Building>,
    pub roads: Vec<Rect>,
    pub indicators: Vec<Indicator>,
    pub lines: Vec<Line>,
    pub spawns: Vec<Tile>,
}

/// The layout for a seed. Deterministic. Tries derived seeds if a draw cannot be made valid.
pub fn generate(seed: u64) -> Layout {
    for attempt in 0..MAX_ATTEMPTS {
        let mut rng = Rng::derive(seed, attempt);
        if let Some(layout) = build(seed, &mut rng) {
            if validate(&layout).is_ok() {
                return layout;
            }
        }
    }
    panic!("no valid layout for seed {seed} after {MAX_ATTEMPTS} attempts");
}

const ROAD_TOP: i32 = 22;
const ROAD_BOTTOM: i32 = 25;
const MAIN_FIRST_X: i32 = 4;
const MAIN_LAST_X: i32 = 43;

/// The north side's rows; the south side mirrors them (z -> HEIGHT - 1 - z).
struct Rows;
impl Rows {
    const HOUSE_FIRST: i32 = 8;
    const HOUSE_LAST: i32 = 13;
    const METERS: i32 = 14;
    const WATER: i32 = 16;
    const GAS: i32 = 17;
    const TELECOM: i32 = 18;
    const ELECTRIC: i32 = 19;
    const DRAIN: i32 = 20;
    const SEWER: i32 = 21;
}

fn lot_centers(count: i32) -> Vec<i32> {
    if count == 2 {
        vec![14, 34]
    } else {
        vec![10, 24, 38]
    }
}

fn hline(x0: i32, x1: i32, z: i32) -> Vec<Tile> {
    (x0..=x1).map(|x| (x, z)).collect()
}

fn vline(x: i32, z0: i32, z1: i32) -> Vec<Tile> {
    let step = if z1 >= z0 { 1 } else { -1 };
    let mut tiles = Vec::new();
    let mut z = z0;
    loop {
        tiles.push((x, z));
        if z == z1 {
            break;
        }
        z += step;
    }
    tiles
}

struct Builder {
    layout: Layout,
}

impl Builder {
    fn add_line(&mut self, rng: &mut Rng, kind: UtilityKind, tiles: Vec<Tile>) -> usize {
        let (low, high) = kind.depth_range();
        let mut depth = rng.range(low, high);
        let mut depths = Vec::with_capacity(tiles.len());
        for _ in &tiles {
            depths.push(depth);
            let step = [-3, 0, 0, 3][rng.range(0, 3) as usize];
            depth = (depth + step).clamp(low, high);
        }
        self.layout.lines.push(Line {
            kind,
            tiles,
            depths,
        });
        self.layout.lines.len() - 1
    }

    fn add_indicator(&mut self, kind: IndicatorKind, tile: Tile, lines: Vec<usize>) {
        let id = self.layout.indicators.len();
        self.layout.indicators.push(Indicator {
            id,
            kind,
            tile,
            lines,
        });
    }
}

fn build(seed: u64, rng: &mut Rng) -> Option<Layout> {
    let mut b = Builder {
        layout: Layout {
            seed,
            buildings: Vec::new(),
            roads: vec![Rect {
                x0: 0,
                z0: ROAD_TOP,
                x1: WIDTH - 1,
                z1: ROAD_BOTTOM,
            }],
            indicators: Vec::new(),
            lines: Vec::new(),
            spawns: vec![
                (8, 23),
                (16, 24),
                (24, 23),
                (32, 24),
                (40, 23),
                (12, 24),
                (28, 23),
                (36, 24),
            ],
        },
    };
    let centers = lot_centers(rng.range(2, 3));

    for north in [true, false] {
        let z = |row: i32| if north { row } else { HEIGHT - 1 - row };
        build_side(&mut b, rng, &centers, north, &z);
    }
    resolve_crossings(&mut b.layout.lines).then_some(b.layout)
}

fn build_side(
    b: &mut Builder,
    rng: &mut Rng,
    centers: &[i32],
    north: bool,
    z: &dyn Fn(i32) -> i32,
) {
    for &x in centers {
        let (z0, z1) = (
            z(Rows::HOUSE_FIRST).min(z(Rows::HOUSE_LAST)),
            z(Rows::HOUSE_FIRST).max(z(Rows::HOUSE_LAST)),
        );
        b.layout.buildings.push(Building {
            rect: Rect {
                x0: x - 4,
                z0,
                x1: x + 3,
                z1,
            },
            faces_larger_z: north,
        });
    }

    // Mains, one row each, running the length of the site.
    let water = b.add_line(
        rng,
        UtilityKind::Water,
        hline(MAIN_FIRST_X, MAIN_LAST_X, z(Rows::WATER)),
    );
    let gas = b.add_line(
        rng,
        UtilityKind::Gas,
        hline(MAIN_FIRST_X, MAIN_LAST_X, z(Rows::GAS)),
    );
    let telecom = b.add_line(
        rng,
        UtilityKind::Telecom,
        hline(MAIN_FIRST_X, MAIN_LAST_X, z(Rows::TELECOM)),
    );
    let electric = b.add_line(
        rng,
        UtilityKind::Electric,
        hline(MAIN_FIRST_X, MAIN_LAST_X, z(Rows::ELECTRIC)),
    );
    let sewer = b.add_line(
        rng,
        UtilityKind::Sewer,
        hline(MAIN_FIRST_X, MAIN_LAST_X, z(Rows::SEWER)),
    );

    for x in [MAIN_FIRST_X, MAIN_LAST_X] {
        b.add_indicator(IndicatorKind::Hydrant, (x, z(Rows::WATER)), vec![water]);
        b.add_indicator(IndicatorKind::GasMarker, (x, z(Rows::GAS)), vec![gas]);
        b.add_indicator(
            IndicatorKind::PowerPole,
            (x, z(Rows::ELECTRIC)),
            vec![electric],
        );
        b.add_indicator(IndicatorKind::Manhole, (x, z(Rows::SEWER)), vec![sewer]);
    }
    b.add_indicator(IndicatorKind::Manhole, (24, z(Rows::SEWER)), vec![sewer]);
    if rng.chance(0.5) {
        b.add_indicator(
            IndicatorKind::Vault,
            (24, z(Rows::ELECTRIC)),
            vec![electric],
        );
    }

    for &x in centers {
        b.add_indicator(
            IndicatorKind::Dogbox,
            (x + 5, z(Rows::TELECOM)),
            vec![telecom],
        );

        // Water service from the meter on the house wall to the main: tiles meter row .. just before the main.
        let water_x = x - 1;
        let service = b.add_line(
            rng,
            UtilityKind::Water,
            vline(water_x, z(Rows::METERS), z(Rows::WATER - 1)),
        );
        b.add_indicator(
            IndicatorKind::WaterMeter,
            (water_x, z(Rows::METERS)),
            vec![service],
        );

        // Gas service runs on to the gas main, so it crosses the water main on the way.
        if rng.chance(0.85) {
            let gas_x = x + 2;
            let service = b.add_line(
                rng,
                UtilityKind::Gas,
                vline(gas_x, z(Rows::METERS), z(Rows::WATER)),
            );
            b.add_indicator(
                IndicatorKind::GasMeter,
                (gas_x, z(Rows::METERS)),
                vec![service],
            );
        }
    }

    // Storm drains between lots, each with a short lateral to the sewer main.
    let mut drain_xs: Vec<i32> = centers
        .windows(2)
        .map(|pair| (pair[0] + pair[1]) / 2)
        .collect();
    if rng.chance(0.5) {
        drain_xs.push(rng.range(7, 40));
    }
    drain_xs.sort_unstable();
    drain_xs.dedup();
    for x in drain_xs {
        let lateral = b.add_line(rng, UtilityKind::Sewer, vec![(x, z(Rows::DRAIN))]);
        b.add_indicator(IndicatorKind::Drain, (x, z(Rows::DRAIN)), vec![lateral]);
    }
}

/// Make every shared tile satisfy MIN_SEPARATION by moving depths at crossings and
/// smoothing along the line. Returns false if the passes could not settle.
fn resolve_crossings(lines: &mut [Line]) -> bool {
    for _ in 0..MAX_RELAX_PASSES {
        let conflicts = find_conflicts(lines);
        let Some(&(a, a_at, b, b_at)) = conflicts.first() else {
            return true;
        };
        let (da, db) = (lines[a].depths[a_at], lines[b].depths[b_at]);
        // Try moving b, then a, to the nearest depth that is far enough away and inside its range.
        let candidates = [(b, b_at, da, db), (a, a_at, db, da)];
        let mut best: Option<(i32, usize, usize, i32)> = None; // (cost, line, at, target)
        for (line, at, other, current) in candidates {
            let (low, high) = lines[line].kind.depth_range();
            for target in [other + MIN_SEPARATION, other - MIN_SEPARATION] {
                if (low..=high).contains(&target) {
                    let cost = (target - current).abs();
                    if best.is_none_or(|(c, ..)| cost < c) {
                        best = Some((cost, line, at, target));
                    }
                }
            }
        }
        let Some((_, line, at, target)) = best else {
            return false;
        };
        lines[line].depths[at] = target;
        smooth_from(&mut lines[line], at);
    }
    find_conflicts(lines).is_empty()
}

/// Keep slope and range valid by spreading a changed depth outward from `at`.
fn smooth_from(line: &mut Line, at: usize) {
    let (low, high) = line.kind.depth_range();
    for i in at + 1..line.depths.len() {
        line.depths[i] = line.depths[i]
            .clamp(
                line.depths[i - 1] - MAX_SLOPE_PER_TILE,
                line.depths[i - 1] + MAX_SLOPE_PER_TILE,
            )
            .clamp(low, high);
    }
    for i in (0..at).rev() {
        line.depths[i] = line.depths[i]
            .clamp(
                line.depths[i + 1] - MAX_SLOPE_PER_TILE,
                line.depths[i + 1] + MAX_SLOPE_PER_TILE,
            )
            .clamp(low, high);
    }
}

/// Pairs (line a, index in a, line b, index in b) that share a tile too closely.
fn find_conflicts(lines: &[Line]) -> Vec<(usize, usize, usize, usize)> {
    let mut by_tile: HashMap<Tile, Vec<(usize, usize)>> = HashMap::new();
    for (line_index, line) in lines.iter().enumerate() {
        for (at, tile) in line.tiles.iter().enumerate() {
            by_tile.entry(*tile).or_default().push((line_index, at));
        }
    }
    let mut conflicts = Vec::new();
    for entries in by_tile.values() {
        for (i, &(a, a_at)) in entries.iter().enumerate() {
            for &(b, b_at) in &entries[i + 1..] {
                if (lines[a].depths[a_at] - lines[b].depths[b_at]).abs() < MIN_SEPARATION {
                    conflicts.push((a, a_at, b, b_at));
                }
            }
        }
    }
    conflicts.sort_unstable();
    conflicts
}

/// Every rule a layout must meet. Used by `generate` and by the tests.
pub fn validate(layout: &Layout) -> Result<(), String> {
    let in_bounds = |(x, z): Tile| (0..WIDTH).contains(&x) && (0..HEIGHT).contains(&z);

    for (index, line) in layout.lines.iter().enumerate() {
        if line.tiles.is_empty() || line.tiles.len() != line.depths.len() {
            return Err(format!("line {index}: tiles and depths do not match"));
        }
        let (low, high) = line.kind.depth_range();
        for (at, &tile) in line.tiles.iter().enumerate() {
            if !in_bounds(tile) {
                return Err(format!("line {index}: tile {tile:?} is out of bounds"));
            }
            if layout
                .buildings
                .iter()
                .any(|building| building.rect.contains(tile))
            {
                return Err(format!("line {index}: tile {tile:?} is under a building"));
            }
            let depth = line.depths[at];
            if !(low..=high).contains(&depth) {
                return Err(format!(
                    "line {index}: depth {depth} outside {low}..={high} for {}",
                    line.kind.name()
                ));
            }
            if at > 0 && (depth - line.depths[at - 1]).abs() > MAX_SLOPE_PER_TILE {
                return Err(format!("line {index}: slope too steep at tile {at}"));
            }
        }
    }

    if let Some(&(a, a_at, b, b_at)) = find_conflicts(&layout.lines).first() {
        return Err(format!(
            "lines {a} and {b} are too close at tiles {a_at}/{b_at}"
        ));
    }

    let mut implied = vec![false; layout.lines.len()];
    for indicator in &layout.indicators {
        if !in_bounds(indicator.tile) {
            return Err(format!("indicator {} is out of bounds", indicator.id));
        }
        if layout
            .buildings
            .iter()
            .any(|building| building.rect.contains(indicator.tile))
        {
            return Err(format!("indicator {} is inside a building", indicator.id));
        }
        if indicator.lines.is_empty() {
            return Err(format!("indicator {} implies no line", indicator.id));
        }
        for &line_index in &indicator.lines {
            let line = layout
                .lines
                .get(line_index)
                .ok_or("indicator points at a missing line")?;
            if line.kind != indicator.kind.utility() {
                return Err(format!(
                    "indicator {} implies the wrong kind of line",
                    indicator.id
                ));
            }
            let near = line.tiles.iter().any(|&(x, z)| {
                (x - indicator.tile.0).abs() <= INDICATOR_REACH
                    && (z - indicator.tile.1).abs() <= INDICATOR_REACH
            });
            if !near {
                return Err(format!(
                    "indicator {} is too far from its line",
                    indicator.id
                ));
            }
            implied[line_index] = true;
        }
    }
    if let Some(index) = implied.iter().position(|&seen| !seen) {
        return Err(format!(
            "line {index} has no indicator, so it is undiscoverable"
        ));
    }

    let lots = layout.buildings.len();
    if !(4..=6).contains(&lots) {
        return Err(format!("{lots} lots; expected 4 to 6"));
    }
    if layout.spawns.iter().any(|&tile| {
        !in_bounds(tile)
            || layout
                .buildings
                .iter()
                .any(|building| building.rect.contains(tile))
    }) {
        return Err("a spawn point is out of bounds or inside a building".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEEDS: u64 = 400;

    #[test]
    fn should_return_the_same_layout_when_given_the_same_seed() {
        let (a, b) = (generate(12345), generate(12345));
        assert_eq!(a.lines.len(), b.lines.len());
        for (x, y) in a.lines.iter().zip(&b.lines) {
            assert_eq!((x.kind, &x.tiles, &x.depths), (y.kind, &y.tiles, &y.depths));
        }
        assert_eq!(
            a.indicators
                .iter()
                .map(|i| (i.kind, i.tile))
                .collect::<Vec<_>>(),
            b.indicators
                .iter()
                .map(|i| (i.kind, i.tile))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn should_give_different_layouts_when_seeds_differ() {
        let depths = |seed| {
            generate(seed)
                .lines
                .iter()
                .flat_map(|l| l.depths.clone())
                .collect::<Vec<_>>()
        };
        assert_ne!(depths(1), depths(2));
    }

    #[test]
    fn should_pass_every_validity_rule_when_generating_many_seeds() {
        for seed in 0..SEEDS {
            let layout = generate(seed);
            assert_eq!(validate(&layout), Ok(()), "seed {seed}");
        }
    }

    #[test]
    fn should_keep_every_depth_inside_its_type_range_and_slope_limit() {
        for seed in 0..SEEDS {
            for line in &generate(seed).lines {
                let (low, high) = line.kind.depth_range();
                assert!(
                    line.depths.iter().all(|d| (low..=high).contains(d)),
                    "seed {seed}"
                );
                assert!(
                    line.depths
                        .windows(2)
                        .all(|w| (w[0] - w[1]).abs() <= MAX_SLOPE_PER_TILE),
                    "seed {seed}"
                );
            }
        }
    }

    #[test]
    fn should_separate_lines_by_the_minimum_when_they_share_a_tile() {
        let mut crossings = 0;
        for seed in 0..SEEDS {
            let layout = generate(seed);
            assert!(find_conflicts(&layout.lines).is_empty(), "seed {seed}");
            let mut seen: HashMap<Tile, usize> = HashMap::new();
            for line in &layout.lines {
                for tile in &line.tiles {
                    *seen.entry(*tile).or_default() += 1;
                }
            }
            crossings += seen.values().filter(|&&count| count > 1).count();
        }
        assert!(
            crossings > SEEDS as usize,
            "the generator should produce crossings to test ({crossings})"
        );
    }

    #[test]
    fn should_give_every_indicator_a_nearby_line_of_the_matching_type() {
        for seed in 0..SEEDS {
            let layout = generate(seed);
            assert!(!layout.indicators.is_empty());
            for indicator in &layout.indicators {
                assert!(
                    !indicator.lines.is_empty(),
                    "seed {seed}: indicator {} has no line",
                    indicator.id
                );
                for &index in &indicator.lines {
                    assert_eq!(layout.lines[index].kind, indicator.kind.utility());
                }
            }
        }
    }

    #[test]
    fn should_leave_no_line_without_an_indicator() {
        for seed in 0..SEEDS {
            let layout = generate(seed);
            for index in 0..layout.lines.len() {
                assert!(
                    layout.indicators.iter().any(|i| i.lines.contains(&index)),
                    "seed {seed}: line {index}"
                );
            }
        }
    }

    #[test]
    fn should_stay_inside_the_grid_and_out_from_under_buildings() {
        for seed in 0..SEEDS {
            let layout = generate(seed);
            for line in &layout.lines {
                for &(x, z) in &line.tiles {
                    assert!(
                        (0..WIDTH).contains(&x) && (0..HEIGHT).contains(&z),
                        "seed {seed}"
                    );
                    assert!(
                        layout.buildings.iter().all(|b| !b.rect.contains((x, z))),
                        "seed {seed}"
                    );
                }
            }
        }
    }

    #[test]
    fn should_make_four_to_six_lots() {
        let mut counts = std::collections::HashSet::new();
        for seed in 0..SEEDS {
            counts.insert(generate(seed).buildings.len());
        }
        assert_eq!(counts, [4usize, 6].into_iter().collect());
    }

    #[test]
    fn should_use_all_five_utility_types_in_every_layout() {
        for seed in 0..50 {
            let kinds: std::collections::HashSet<_> =
                generate(seed).lines.iter().map(|l| l.kind).collect();
            assert_eq!(kinds.len(), 5, "seed {seed}");
        }
    }

    #[test]
    fn should_spot_a_broken_layout_when_validating() {
        let mut layout = generate(7);
        layout.lines[0].depths[0] = 5; // out of range
        assert!(validate(&layout).is_err());
        let mut layout = generate(7);
        layout.indicators[0].lines.clear();
        assert!(validate(&layout).is_err());
    }
}
