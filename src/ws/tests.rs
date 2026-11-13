use super::*;

#[test]
fn client_msg_input_deserializes() {
    let msg: ClientMsg = serde_json::from_str(r#"{"type":"input","data":"ls\n"}"#).unwrap();
    match msg {
        ClientMsg::Input { data, claim } => {
            assert_eq!(data, "ls\n");
            assert!(claim.is_none());
        }
        _ => panic!("expected Input"),
    }
}

#[test]
fn client_msg_input_with_claim_deserializes() {
    let msg: ClientMsg =
        serde_json::from_str(r#"{"type":"input","data":"a","claim":{"cols":100,"rows":30}}"#)
            .unwrap();
    match msg {
        ClientMsg::Input { data, claim } => {
            assert_eq!(data, "a");
            assert_eq!(claim, Some(super::types::SizeClaim { cols: 100, rows: 30 }));
        }
        _ => panic!("expected Input"),
    }
}

#[test]
fn client_msg_claim_deserializes() {
    let msg: ClientMsg = serde_json::from_str(r#"{"type":"claim","cols":100,"rows":30}"#).unwrap();
    match msg {
        ClientMsg::Claim { cols, rows } => {
            assert_eq!(cols, 100);
            assert_eq!(rows, 30);
        }
        _ => panic!("expected Claim"),
    }
}

#[test]
fn client_msg_snapshot_request_defaults_claim_to_false() {
    let msg: ClientMsg =
        serde_json::from_str(r#"{"type":"snapshot_request","cols":100,"rows":30}"#).unwrap();
    match msg {
        ClientMsg::SnapshotRequest { cols, rows, claim } => {
            assert_eq!((cols, rows), (100, 30));
            assert!(!claim);
        }
        _ => panic!("expected SnapshotRequest"),
    }
}

#[test]
fn client_msg_resize_deserializes() {
    let msg: ClientMsg = serde_json::from_str(r#"{"type":"resize","cols":120,"rows":40}"#).unwrap();
    match msg {
        ClientMsg::Resize { cols, rows } => {
            assert_eq!(cols, 120);
            assert_eq!(rows, 40);
        }
        _ => panic!("expected Resize"),
    }
}

#[test]
fn sync_client_msg_activate_tab() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"activate_tab","pane_id":"abc"}"#).unwrap();
    match msg {
        SyncClientMsg::ActivateTab { pane_id } => assert_eq!(pane_id, "abc"),
        _ => panic!("expected ActivateTab"),
    }
}

#[test]
fn sync_client_msg_create_tab_with_optional_fields() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"create_tab","layout":{},"tab_id":"t1","pane_id":"p1"}"#)
            .unwrap();
    match msg {
        SyncClientMsg::CreateTab { tab_id, pane_id, .. } => {
            assert_eq!(tab_id.unwrap(), "t1");
            assert_eq!(pane_id.unwrap(), "p1");
        }
        _ => panic!("expected CreateTab"),
    }
}

#[test]
fn sync_client_msg_create_tab_without_optional_fields() {
    let msg: SyncClientMsg = serde_json::from_str(r#"{"type":"create_tab","layout":{}}"#).unwrap();
    match msg {
        SyncClientMsg::CreateTab { tab_id, pane_id, .. } => {
            assert!(tab_id.is_none());
            assert!(pane_id.is_none());
        }
        _ => panic!("expected CreateTab"),
    }
}

#[test]
fn sync_client_msg_close_tab() {
    let msg: SyncClientMsg =
        serde_json::from_str(r#"{"type":"close_tab","pane_id":"p1"}"#).unwrap();
    match msg {
        SyncClientMsg::CloseTab { pane_id } => assert_eq!(pane_id, "p1"),
        _ => panic!("expected CloseTab"),
    }
}

#[test]
fn sync_client_msg_update_layout() {
    let msg: SyncClientMsg = serde_json::from_str(
        r#"{"type":"update_layout","pane_id":"t1","layout":{"type":"leaf"},"active_pane_id":"p1"}"#,
    )
    .unwrap();
    match msg {
        SyncClientMsg::UpdateLayout { pane_id, active_pane_id, .. } => {
            assert_eq!(pane_id, "t1");
            assert_eq!(active_pane_id, "p1");
        }
        _ => panic!("expected UpdateLayout"),
    }
}

#[test]
fn server_msg_output_serializes() {
    let msg = ServerMsg::Output { data: "hello" };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains(r#""type":"output""#));
    assert!(json.contains(r#""data":"hello""#));
}

#[test]
fn server_msg_shell_info_serializes() {
    let msg = ServerMsg::ShellInfo { shell_type: "zsh" };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains(r#""type":"shell_info""#));
    assert!(json.contains(r#""shell_type":"zsh""#));
}
