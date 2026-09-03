//! Hits the real service with a deliberately wrong code, to see exactly what
//! the client makes of the answer. Ignored by default: it needs the network.
//!
//! Run with: cargo test --test live_account -- --ignored --nocapture

use vlyne_lib::account;

#[tokio::test]
#[ignore]
async fn a_wrong_code_surfaces_the_services_own_message() {
    let base = account::DEFAULT_API_BASE;
    println!("base: {base}");

    match account::pair(base, "AAAAAAAA", "probe", None).await {
        Ok(_) => panic!("a bogus code must not be accepted"),
        Err(e) => {
            println!("code   : {}", e.code());
            println!("message: {e}");
            assert!(
                !e.to_string().contains("unreadable"),
                "the service's own message was lost"
            );
        }
    }
}
