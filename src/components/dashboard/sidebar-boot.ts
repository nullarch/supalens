export const COLLAPSED_KEY = "supalens.sidebar.collapsed";

/* Applies the viewer's collapsed-rail preference before first paint (a per-viewer
   convenience; blocked storage simply keeps the rail expanded). Rendered by the
   server layouts that mount DashboardShell. */
export const COLLAPSE_BOOT = `try{if(localStorage.getItem("${COLLAPSED_KEY}")==="1")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;
