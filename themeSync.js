const { ipcRenderer } = require('electron');

// Listen for theme changes from other windows
ipcRenderer.on('theme-changed', (event, themeName) => {
    const { applyTheme } = require('./theme.js');
    applyTheme(themeName);
});

// Function to broadcast theme changes to all windows
function broadcastThemeChange(themeName) {
    ipcRenderer.send('broadcast-theme-change', themeName);
}

module.exports = {
    broadcastThemeChange
}; 