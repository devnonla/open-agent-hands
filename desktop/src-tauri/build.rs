fn main() {
    println!("cargo:rerun-if-env-changed=AGENTHANDS_UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=AGENTHANDS_UPDATER_ENDPOINT");
    tauri_build::build()
}
