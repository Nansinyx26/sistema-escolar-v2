const fs = require('fs');
const path = require('path');

const targetDir = 'c:/Users/Usuario1/Downloads/sistema-escolar-v2-main/sistema-escolar-v2-main';

const optimizeImages = (dir) => {
    fs.readdirSync(dir).forEach(file => {
        let fullPath = path.join(dir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'backend') {
                optimizeImages(fullPath);
            }
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content;

            // Replacing <img ...> with loading="lazy" decoding="async" if not present
            newContent = newContent.replace(/<img(?!.*?loading="lazy")[^>]+>/g, match => {
                if (match.includes('loading=')) return match;
                return match.replace('<img', '<img loading="lazy" decoding="async"');
            });

            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent, 'utf8');
                console.log('Optimized Images:', fullPath);
            }
        }
    });

    // Also let's check JS files to improve performance by throttling scroll/resize and using passive listeners
};

optimizeImages(targetDir);

// Now patch utils.js to include a debounce/throttle and patch EventListeners
const updateUtilsJS = () => {
    const utilsPath = path.join(targetDir, 'js', 'utils.js');
    if (fs.existsSync(utilsPath)) {
        let content = fs.readFileSync(utilsPath, 'utf8');
        if (!content.includes('function debounce(')) {
            content += `\n
// === PERFORMANCE UTILS ===
window.debounce = function(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

window.throttle = function(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
};

// Override addEventListener to default to passive for scroll/wheel/touchstart/touchmove
(function() {
    let supportsPassive = false;
    try {
        let opts = Object.defineProperty({}, 'passive', {
            get: function() {
                supportsPassive = true;
            }
        });
        window.addEventListener('testPassive', null, opts);
        window.removeEventListener('testPassive', null, opts);
    } catch (e) {}

    if (supportsPassive) {
        let originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (options === undefined && (type === 'scroll' || type === 'wheel' || type === 'touchstart' || type === 'touchmove')) {
                options = { passive: true };
            }
            return originalAddEventListener.call(this, type, listener, options);
        };
    }
})();
`;
            fs.writeFileSync(utilsPath, content, 'utf8');
            console.log('utils.js extended w/ performance utils');
        }
    }
}

updateUtilsJS();

console.log('Pass 2 done!');
