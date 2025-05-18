const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const progressManager = require('./progress-manager');

let mainWindow;
const bookWindows = new Set();
let bookList = [];

// Load book list from file
function loadBookList() {
    try {
        const dataPath = path.join(app.getPath('userData'), 'book-list.json');
        if (fs.existsSync(dataPath)) {
            bookList = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading book list:', error);
    }
}

// Save book list to file
function saveBookList() {
    try {
        const dataPath = path.join(app.getPath('userData'), 'book-list.json');
        fs.writeFileSync(dataPath, JSON.stringify(bookList), 'utf8');
    } catch (error) {
        console.error('Error saving book list:', error);
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile('mainWindow.html');
    mainWindow.setMenuBarVisibility(false);
    
    // Add DevTools shortcut
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.key.toLowerCase() === 'i') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
}

function createBookWindow(bookPath) {
    const bookWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    const fileExt = path.extname(bookPath).toLowerCase();
    if (fileExt === '.pdf') {
        bookWindow.loadFile('index.html');
    } else if (fileExt === '.epub') {
        bookWindow.loadFile('epub-reader.html');
    }

    bookWindow.setMenuBarVisibility(false);
    
    // Add DevTools shortcut
    bookWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.key.toLowerCase() === 'i') {
            bookWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
    
    bookWindows.add(bookWindow);
    
    bookWindow.on('closed', () => {
        bookWindows.delete(bookWindow);
    });

    // Send book path to window once it's ready
    bookWindow.webContents.on('did-finish-load', () => {
        const fileContent = fs.readFileSync(bookPath);
        const progress = progressManager.getBookProgress(bookPath);
        bookWindow.webContents.send('load-book', {
            content: fileContent.toString('base64'),
            type: fileExt.slice(1), // 'pdf' or 'epub'
            path: bookPath,
            progress: progress
        });
    });
}

app.whenReady().then(() => {
    loadBookList();
    createMainWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// IPC handlers
ipcMain.handle('get-book-list', () => {
    mainWindow.webContents.send('update-book-list', bookList);
});

ipcMain.handle('import-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Directory with Books'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const dirPath = result.filePaths[0];
        const files = fs.readdirSync(dirPath);
        let importedCount = 0;

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const ext = path.extname(filePath).toLowerCase();
            
            // Only process .pdf and .epub files
            if (ext === '.pdf' || ext === '.epub') {
                const name = path.basename(filePath);
                const type = ext.slice(1).toLowerCase();
                
                // Check if book is already in the list
                if (!bookList.some(book => book.path === filePath)) {
                    bookList.push({ name, path: filePath, type });
                    importedCount++;
                }
            }
        }

        if (importedCount > 0) {
            saveBookList();
            mainWindow.webContents.send('update-book-list', bookList);
            mainWindow.webContents.send('directory-import-complete', importedCount);
        }
    }
});

ipcMain.handle('add-book', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Books', extensions: ['pdf', 'epub'] },
            { name: 'PDF Files', extensions: ['pdf'] },
            { name: 'EPUB Files', extensions: ['epub'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const name = path.basename(filePath);
        const type = path.extname(filePath).slice(1).toLowerCase();
        
        // Check if book is already in the list
        if (!bookList.some(book => book.path === filePath)) {
            bookList.push({ name, path: filePath, type });
            saveBookList();
            mainWindow.webContents.send('update-book-list', bookList);
        }
    }
});

ipcMain.handle('open-book-window', (event, bookPath) => {
    createBookWindow(bookPath);
});

// Handler for getting book buffer for metadata extraction
ipcMain.handle('get-book-buffer', async (event, bookPath) => {
    try {
        const buffer = fs.readFileSync(bookPath);
        return buffer;
    } catch (error) {
        console.error('Error reading book file:', error);
        return null;
    }
});

// Handle book deletion
ipcMain.handle('delete-book', async (event, bookPath) => {
    try {
        // Remove book from the list
        bookList = bookList.filter(book => book.path !== bookPath);
        
        // Save updated book list
        saveBookList();
        
        // Notify renderer about the updated list
        mainWindow.webContents.send('book-list-updated', bookList);
        
        return true;
    } catch (error) {
        console.error('Error deleting book:', error);
        return false;
    }
});

// Add theme synchronization handler
ipcMain.on('broadcast-theme-change', (event, themeName) => {
    // Save theme to all windows except sender
    const sender = event.sender;
    const allWindows = [mainWindow, ...bookWindows];
    
    allWindows.forEach(window => {
        if (window && window.webContents !== sender) {
            window.webContents.send('theme-changed', themeName);
        }
    });
});

// Add new IPC handler for saving progress
ipcMain.on('save-reading-progress', (event, data) => {
    progressManager.updateBookProgress(data.bookPath, data.location);
}); 