export const THEME_STORAGE_KEY = "ig-theme";

// Runs in <head> before first paint so a saved light theme never flashes dark.
export const themeInitScript = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;
