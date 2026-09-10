use super::types::{validate_create_tab_request, CreateTabRequest};

fn request(argv: Vec<&str>) -> CreateTabRequest {
    CreateTabRequest {
        cwd: None,
        source_pane_id: None,
        argv: Some(argv.into_iter().map(str::to_string).collect()),
        title: None,
    }
}

#[test]
fn create_tab_argv_requires_non_empty_program() {
    assert!(validate_create_tab_request(&request(vec![])).is_err());
    assert!(validate_create_tab_request(&request(vec![""])).is_err());
    assert!(validate_create_tab_request(&request(vec!["claude", ""])).is_ok());
    assert!(validate_create_tab_request(&request(vec!["claude", "--resume"])).is_ok());
}

#[test]
fn create_tab_argv_rejects_nul_bytes() {
    assert!(validate_create_tab_request(&request(vec!["claude\0", "--resume"])).is_err());
    assert!(validate_create_tab_request(&request(vec!["claude", "--resume\0"])).is_err());
}
