// Evita abrir uma janela de terminal junto no Windows (build final). Não remover.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quill_lib::run();
}
