use std::fs;
use std::path::Path;

fn rerun_if_dist_contents(dir: &Path) {
    if !dir.is_dir() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                println!("cargo:rerun-if-changed={}", p.display());
            } else if p.is_dir() {
                rerun_if_dist_contents(&p);
            }
        }
    }
}

fn main() {
    let dist = Path::new("../frontend/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    rerun_if_dist_contents(dist);
    tauri_build::build();
}
