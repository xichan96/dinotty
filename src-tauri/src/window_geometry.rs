//! Pure geometry for placing a newly created preview window next to the main
//! window.
//!
//! The rules mirror `docs/mockups/file-browser-window-layout.html`:
//!
//! 1. If either side of the main window has at least the minimum width, place
//!    the preview beside it without overlapping (right side first).
//! 2. Otherwise place it over the main window at 95 % of its size, offset by
//!    48 px towards the roomier side, so the title bar stays visible.
//! 3. Without a usable main window (missing, hidden, fullscreen, or a read
//!    failure) centre the preview on 80 % of the work area.
//! 4. If even the work area is unavailable, fall back to 960 × 640.
//!
//! Everything here is pure: monitor reading and physical/logical conversion
//! live in [`main_window_geometry`], which is the only Tauri-aware entry
//! point. Sizes and positions are logical pixels.

use tauri::{AppHandle, Manager};

/// Default preview size, used both for web previews and as the last-resort
/// fallback when no monitor can be read.
pub const DEFAULT_WIDTH: f64 = 960.0;
pub const DEFAULT_HEIGHT: f64 = 640.0;

/// Minimum content size enforced by the preview window builder.
pub const MIN_WIDTH: f64 = 480.0;
pub const MIN_HEIGHT: f64 = 320.0;

/// Distance kept between the preview and the work-area edges.
const MARGIN: f64 = 36.0;
/// Gap between the main window and a side-by-side preview.
const GAP: f64 = 18.0;
/// Offset applied to an overlapping preview, on both axes.
const OFFSET: f64 = 48.0;
/// Overlapping previews shrink to this fraction of the main window.
const SHRINK: f64 = 0.95;
/// Fallback preview size as a fraction of the work area.
const CENTERED_RATIO: f64 = 0.8;

/// A rectangle in logical pixels. Coordinates are relative to the virtual
/// desktop origin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    #[must_use]
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { x, y, width, height }
    }

    #[must_use]
    pub fn right(self) -> f64 {
        self.x + self.width
    }

    #[must_use]
    pub fn bottom(self) -> f64 {
        self.y + self.height
    }

    fn is_valid(self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && self.x.is_finite()
            && self.y.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }
}

/// Logical content size for the new preview window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    #[must_use]
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

/// Logical outer-frame top-left corner for the new preview window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

impl Position {
    #[must_use]
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// Which layout rule produced the geometry. Useful for logging and tests.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Placement {
    SideRight,
    SideLeft,
    OffsetRight,
    OffsetLeft,
    Centered,
    Default,
}

/// Result of the placement algorithm.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowGeometry {
    pub size: Size,
    /// `None` only for [`Placement::Default`]: let the OS choose the position.
    pub position: Option<Position>,
    pub placement: Placement,
}

impl WindowGeometry {
    fn default_geometry() -> Self {
        Self {
            size: Size::new(DEFAULT_WIDTH, DEFAULT_HEIGHT),
            position: None,
            placement: Placement::Default,
        }
    }

    fn centered(work_area: Rect) -> Self {
        if !work_area.is_valid() {
            return Self::default_geometry();
        }
        let width = (work_area.width * CENTERED_RATIO).min(work_area.width);
        let height = (work_area.height * CENTERED_RATIO).min(work_area.height);
        Self {
            size: Size::new(width, height),
            position: Some(Position::new(
                work_area.x + (work_area.width - width) / 2.0,
                work_area.y + (work_area.height - height) / 2.0,
            )),
            placement: Placement::Centered,
        }
    }
}

/// Clamp `value` into `[min, max]`, tolerating an inverted range by returning
/// the lower bound.
fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        min
    } else {
        value.max(min).min(max)
    }
}

/// Pick the preview geometry when a main window is available.
///
/// `main` is the main window rectangle (outer top-left, inner size) and
/// `work_area` is the monitor work area, both in logical pixels. `min_size`
/// is the smallest content size accepted by the window builder.
#[must_use]
pub fn place_preview(
    main: Option<Rect>,
    work_area: Option<Rect>,
    min_size: Size,
) -> WindowGeometry {
    let Some(work_area) = work_area.filter(|area| area.is_valid()) else {
        return WindowGeometry::default_geometry();
    };
    let Some(main) = main.filter(|rect| rect.is_valid()) else {
        return WindowGeometry::centered(work_area);
    };

    let usable_height = work_area.height - 2.0 * MARGIN;
    if usable_height <= 0.0 || work_area.width <= 2.0 * MARGIN {
        return WindowGeometry::centered(work_area);
    }

    let right_space = work_area.right() - MARGIN - (main.right() + GAP);
    let left_space = (main.x - GAP) - (work_area.x + MARGIN);

    if right_space >= min_size.width {
        let width = main.width.max(min_size.width).min(right_space);
        let height = main.height.clamp(min_size.height.min(usable_height), usable_height);
        return WindowGeometry {
            size: Size::new(width, height),
            position: Some(Position::new(
                main.right() + GAP,
                clamp(main.y, work_area.y + MARGIN, work_area.bottom() - MARGIN - height),
            )),
            placement: Placement::SideRight,
        };
    }

    if left_space >= min_size.width {
        let width = main.width.max(min_size.width).min(left_space);
        let height = main.height.clamp(min_size.height.min(usable_height), usable_height);
        return WindowGeometry {
            size: Size::new(width, height),
            position: Some(Position::new(
                main.x - GAP - width,
                clamp(main.y, work_area.y + MARGIN, work_area.bottom() - MARGIN - height),
            )),
            placement: Placement::SideLeft,
        };
    }

    // Neither side fits: overlap the main window, staying offset so its title
    // bar (top 30 px) and one vertical edge remain reachable.
    let max_width = work_area.width - 2.0 * MARGIN;
    let width = (main.width * SHRINK).min(max_width).max(min_size.width.min(max_width));
    let height = (main.height * SHRINK).min(usable_height).max(min_size.height.min(usable_height));
    let go_right = right_space >= left_space;
    let desired_x = if go_right { main.x + OFFSET } else { main.right() - OFFSET - width };
    let x = clamp(desired_x, work_area.x + MARGIN, work_area.right() - MARGIN - width);
    let y = clamp(main.y + OFFSET, work_area.y + MARGIN, work_area.bottom() - MARGIN - height);

    WindowGeometry {
        size: Size::new(width, height),
        position: Some(Position::new(x, y)),
        placement: if go_right { Placement::OffsetRight } else { Placement::OffsetLeft },
    }
}

/// Logical rectangles read from the live Tauri windows.
struct LiveGeometry {
    main: Option<Rect>,
    work_area: Option<Rect>,
}

fn physical_rect(position: (f64, f64), size: (f64, f64), scale: f64) -> Rect {
    Rect::new(position.0 / scale, position.1 / scale, size.0 / scale, size.1 / scale)
}

/// Read the main window and monitor geometry, converting physical pixels to
/// logical ones with the scale factor of the monitor the preview will land on.
///
/// Returns `None` for the main rectangle when the window is missing, hidden,
/// minimised, fullscreen, or any property cannot be read; the caller then
/// falls back to a centred preview.
fn read_live_geometry(app: &AppHandle) -> LiveGeometry {
    let main_window = app.get_webview_window("main");

    let (main, work_area) = match main_window {
        Some(window) => {
            let monitor = window.current_monitor().ok().flatten();
            let scale =
                monitor.as_ref().map_or(1.0, tauri::Monitor::scale_factor).max(f64::MIN_POSITIVE);
            let work_area = monitor.as_ref().map(|monitor| {
                let area = monitor.work_area();
                physical_rect(
                    (f64::from(area.position.x), f64::from(area.position.y)),
                    (f64::from(area.size.width), f64::from(area.size.height)),
                    scale,
                )
            });
            let usable = !window.is_minimized().unwrap_or(false)
                && window.is_visible().unwrap_or(false)
                && !window.is_fullscreen().unwrap_or(false);
            let main = if usable {
                match (window.outer_position(), window.inner_size()) {
                    (Ok(position), Ok(size)) => Some(physical_rect(
                        (f64::from(position.x), f64::from(position.y)),
                        (f64::from(size.width), f64::from(size.height)),
                        scale,
                    )),
                    _ => None,
                }
            } else {
                None
            };
            (main, work_area)
        }
        None => (None, None),
    };

    // Without a main window the preview still needs a monitor to centre on.
    let work_area = work_area.or_else(|| {
        app.primary_monitor().ok().flatten().map(|monitor| {
            let scale = monitor.scale_factor().max(f64::MIN_POSITIVE);
            let area = monitor.work_area();
            physical_rect(
                (f64::from(area.position.x), f64::from(area.position.y)),
                (f64::from(area.size.width), f64::from(area.size.height)),
                scale,
            )
        })
    });

    LiveGeometry { main, work_area }
}

/// Tauri-aware entry point used by the preview window builder.
///
/// Must be called on the main thread (the builder already runs there).
#[must_use]
pub fn main_window_geometry(app: &AppHandle) -> WindowGeometry {
    let live = read_live_geometry(app);
    place_preview(live.main, live.work_area, Size::new(MIN_WIDTH, MIN_HEIGHT))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: Size = Size::new(MIN_WIDTH, MIN_HEIGHT);

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect::new(x, y, width, height)
    }

    #[test]
    fn places_beside_on_the_right_with_zero_overlap() {
        let geometry = place_preview(
            Some(rect(100.0, 60.0, 800.0, 600.0)),
            Some(rect(0.0, 25.0, 1440.0, 875.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::SideRight);
        assert_eq!(geometry.size, Size::new(486.0, 600.0));
        // The work area starts 25 px down, plus the 36 px margin, so the
        // preview's top edge snaps to 61 even though the main window is at 60.
        assert_eq!(geometry.position, Some(Position::new(918.0, 61.0)));
        let position = geometry.position.unwrap();
        assert!(position.x >= 100.0 + 800.0, "must not overlap the main window");
        assert!(
            position.x + geometry.size.width <= 1440.0 - MARGIN + f64::EPSILON,
            "must stay inside the work-area margin"
        );
    }

    #[test]
    fn falls_back_to_the_left_when_the_right_side_is_too_narrow() {
        let geometry = place_preview(
            Some(rect(600.0, 50.0, 800.0, 600.0)),
            Some(rect(0.0, 0.0, 1440.0, 900.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::SideLeft);
        assert_eq!(geometry.size, Size::new(546.0, 600.0));
        assert_eq!(geometry.position, Some(Position::new(36.0, 50.0)));
        let position = geometry.position.unwrap();
        assert!(position.x + geometry.size.width <= 600.0, "must not overlap the main window");
    }

    #[test]
    fn offsets_over_the_main_window_when_neither_side_fits() {
        let main = rect(100.0, 100.0, 500.0, 600.0);
        let geometry = place_preview(Some(main), Some(rect(0.0, 0.0, 1000.0, 800.0)), MIN);

        assert_eq!(geometry.placement, Placement::OffsetRight);
        // 95 % of 500 is 475, raised to the 480 px builder minimum.
        assert_eq!(geometry.size, Size::new(480.0, 570.0));
        assert_eq!(geometry.position, Some(Position::new(148.0, 148.0)));
        let position = geometry.position.unwrap();
        assert!(position.y >= main.y + 30.0, "the main title bar must stay visible");
        assert!(position.x > main.x, "the preview shifts towards the roomier side");
    }

    #[test]
    fn offsets_left_towards_the_roomier_side() {
        let main = rect(500.0, 100.0, 500.0, 600.0);
        let geometry = place_preview(Some(main), Some(rect(0.0, 0.0, 1000.0, 800.0)), MIN);

        assert_eq!(geometry.placement, Placement::OffsetLeft);
        // Right edge sits 48 px inside the main window's right edge.
        assert_eq!(geometry.position, Some(Position::new(472.0, 148.0)));
        let position = geometry.position.unwrap();
        assert!(position.y >= main.y + 30.0, "the main title bar must stay visible");
        assert!(position.x < main.x, "the preview shifts towards the roomier side");
    }

    #[test]
    fn clamps_an_offset_preview_into_the_work_area() {
        let geometry = place_preview(
            Some(rect(0.0, 0.0, 1000.0, 700.0)),
            Some(rect(0.0, 0.0, 1000.0, 700.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::OffsetRight);
        assert_eq!(geometry.size, Size::new(928.0, 628.0));
        assert_eq!(
            geometry.position,
            Some(Position::new(MARGIN, MARGIN)),
            "both axes must clamp to the work-area margin"
        );
    }

    #[test]
    fn respects_the_work_area_origin_of_a_secondary_monitor() {
        let geometry = place_preview(
            Some(rect(1540.0, 50.0, 800.0, 600.0)),
            Some(rect(1440.0, 0.0, 1440.0, 900.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::SideRight);
        assert_eq!(geometry.position, Some(Position::new(2358.0, 50.0)));
        let position = geometry.position.unwrap();
        assert!(position.x >= 1440.0, "must land on the secondary monitor");
    }

    #[test]
    fn centres_at_eighty_percent_without_a_main_window() {
        let geometry = place_preview(None, Some(rect(0.0, 25.0, 1440.0, 875.0)), MIN);

        assert_eq!(geometry.placement, Placement::Centered);
        assert_eq!(geometry.size, Size::new(1152.0, 700.0));
        assert_eq!(geometry.position, Some(Position::new(144.0, 112.5)));
    }

    #[test]
    fn keeps_the_default_size_when_the_work_area_is_unreadable() {
        let geometry = place_preview(Some(rect(10.0, 10.0, 800.0, 600.0)), None, MIN);

        assert_eq!(geometry.placement, Placement::Default);
        assert_eq!(geometry.size, Size::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
        assert_eq!(geometry.position, None);
    }

    #[test]
    fn rejects_nonsense_work_areas() {
        for area in [
            rect(0.0, 0.0, 0.0, 900.0),
            rect(0.0, 0.0, 1440.0, -10.0),
            rect(f64::NAN, 0.0, 1440.0, 900.0),
        ] {
            let geometry = place_preview(Some(rect(0.0, 0.0, 800.0, 600.0)), Some(area), MIN);
            assert_eq!(geometry.placement, Placement::Default, "{area:?}");
        }
    }

    #[test]
    fn side_by_side_respects_the_minimum_width() {
        let geometry = place_preview(
            Some(rect(0.0, 0.0, 300.0, 200.0)),
            Some(rect(0.0, 0.0, 1440.0, 900.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::SideRight);
        assert!(
            geometry.size.width >= MIN_WIDTH,
            "side-by-side width must satisfy the builder minimum"
        );
        assert!(geometry.size.height >= MIN_HEIGHT);
    }

    #[test]
    fn overlapping_preview_respects_the_minimum_size() {
        // Centred 200 × 100 window: 246 px to its left and 446 px to its
        // right, both below the 480 px threshold.
        let geometry = place_preview(
            Some(rect(300.0, 100.0, 200.0, 100.0)),
            Some(rect(0.0, 0.0, 1000.0, 800.0)),
            MIN,
        );

        assert_eq!(geometry.placement, Placement::OffsetRight);
        assert!(geometry.size.width >= MIN_WIDTH);
        assert!(geometry.size.height >= MIN_HEIGHT);
    }
}
