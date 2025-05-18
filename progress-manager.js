const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class ProgressManager {
    constructor() {
        this.progressFile = path.join(app.getPath('userData'), 'reading-progress.json');
        this.progress = this.loadProgress();
    }

    loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                return JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading reading progress:', error);
        }
        return {};
    }

    saveProgress() {
        try {
            fs.writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
        } catch (error) {
            console.error('Error saving reading progress:', error);
        }
    }

    getBookProgress(bookPath) {
        return this.progress[bookPath] || null;
    }

    updateBookProgress(bookPath, location) {
        this.progress[bookPath] = location;
        this.saveProgress();
    }
}

module.exports = new ProgressManager(); 