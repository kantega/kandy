use clap::Parser;
use kandy_app_lib::CliArgs;

fn main() {
    kandy_app_lib::run(CliArgs::parse())
}
