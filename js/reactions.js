/**
 * reactions.js
 * Emoji Reaction System
 * Connects emoticon reactions directly to MongoDB database APIs in real-time.
 * Works across all 37 pages and is fully compatible with PWA installations.
 *
 * v2 — Categorized emoji picker with grid layout and smooth animations.
 */
(function () {
    'use strict';

    // ── Emoji categories ────────────────────────────────────────────────────
    const EMOJI_CATEGORIES = [
        {
            id: 'frequentes',
            icon: '🕐',
            label: 'Frequentes',
            emojis: ['👍', '❤️', '😂', '🔥', '👏', '😮', '😢', '🎉']
        },
        {
            id: 'maos',
            icon: '👋',
            label: 'Mãos',
            emojis: ['👍', '👎', '👏', '🙌', '🤝', '💪', '🙏', '✊']
        },
        {
            id: 'coracoes',
            icon: '❤️',
            label: 'Corações',
            emojis: ['❤️', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍']
        },
        {
            id: 'rostos',
            icon: '😊',
            label: 'Rostos',
            emojis: ['😂', '🤣', '😆', '😄', '😊', '😍', '😘', '😎', '🤔', '🤨', '😮', '🤯', '😲', '😱', '😢', '😭', '🥺']
        },
        {
            id: 'simbolos',
            icon: '⭐',
            label: 'Símbolos',
            emojis: ['🔥', '💯', '⭐', '✨', '🎉', '🎊', '🏆', '🚀']
        },
        {
            id: 'escola',
            icon: '📚',
            label: 'Escola',
            emojis: ['📚', '✏️', '🎓', '📝', '📖', '🏫', '🧑‍🏫', '📐']
        }
    ];

    // Flat list of all unique emojis (used for rendering chips)
    const ALL_EMOJIS = [...new Set(EMOJI_CATEGORIES.flatMap(c => c.emojis))];

    function getCurrentUserId() {
        try {
            const user = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            return user._id || user.id || 'anon';
        } catch (e) {
            return 'anon';
        }
    }

    function buildReactionSummary(reactionsList) {
        const summary = {};
        reactionsList.forEach(r => {
            if (!summary[r.emoji]) {
                summary[r.emoji] = { count: 0, users: [] };
            }
            summary[r.emoji].count++;
            summary[r.emoji].users.push({ name: r.senderName || 'Usuário', type: r.senderType });
        });
        return summary;
    }

    window.renderBarWithData = renderBarWithData;

    /**
     * Creates or updates the reaction bar for a given target element, fetching reactions from MongoDB.
     * @param {HTMLElement} container - The parent element to append the reaction bar to
     * @param {string} itemId - Unique ID for the item being reacted to
     */
    window.createReactionBar = async function (container, itemId) {
        if (!container || !itemId) return;

        // Prevent duplicates
        let bar = container.querySelector('.reaction-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'reaction-bar';
            bar.dataset.itemId = itemId;
            container.appendChild(bar);
        }

        // Fetch from MongoDB
        try {
            const API = window.API_BASE_URL || (
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                    ? 'http://localhost:3001/api'
                    : window.location.origin + '/api'
            );
            const res = await fetch(`${API}/reactions/message/${itemId}`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && json.summary) {
                renderBarWithData(bar, itemId, json.summary);
            } else {
                renderBarWithData(bar, itemId, {});
            }
        } catch (e) {
            console.error('Error fetching reactions:', e);
            renderBarWithData(bar, itemId, {});
        }
    };

    function renderBarWithData(bar, itemId, itemReactions) {
        if (!bar) return;

        bar.innerHTML = '';
        const userId = getCurrentUserId();

        // Render existing reaction chips
        ALL_EMOJIS.forEach(function (emoji) {
            const emojiData = itemReactions[emoji] || { count: 0, users: [] };
            if (emojiData.count > 0) {
                const chip = createReactionChip(emoji, emojiData, userId, itemId);
                bar.appendChild(chip);
            }
        });

        // Also render any emojis from the summary that might not be in ALL_EMOJIS
        Object.keys(itemReactions).forEach(function (emoji) {
            if (!ALL_EMOJIS.includes(emoji) && itemReactions[emoji].count > 0) {
                const chip = createReactionChip(emoji, itemReactions[emoji], userId, itemId);
                bar.appendChild(chip);
            }
        });

        // Add reaction button
        var addBtn = document.createElement('button');
        addBtn.className = 'reaction-add-btn';
        addBtn.innerHTML = '<i class="bi bi-emoji-smile"></i>';
        addBtn.title = 'Reagir';
        addBtn.setAttribute('aria-label', 'Adicionar reação');
        addBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openPickerModal(itemId, bar);
        });

        bar.appendChild(addBtn);
    }

    function createReactionChip(emoji, emojiData, userId, itemId) {
        var chip = document.createElement('button');
        chip.className = 'reaction-chip';
        chip.dataset.emoji = emoji;

        // Check if current user has reacted
        var currentUserName = '';
        try {
            var user = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            currentUserName = user.nome || '';
        } catch (e) {}

        var hasReacted = emojiData.users && emojiData.users.some(function (u) { return u.name === currentUserName; });
        if (hasReacted) {
            chip.classList.add('active');
        }

        chip.innerHTML =
            '<span class="reaction-emoji">' + emoji + '</span>' +
            '<span class="reaction-count">' + emojiData.count + '</span>';

        // Tooltip with user list
        if (emojiData.users && emojiData.users.length > 0) {
            var namesList = emojiData.users.map(function (u) { return u.name; });
            var names = namesList.length <= 3
                ? namesList.join(', ')
                : namesList.slice(0, 2).join(', ') + ' +' + (namesList.length - 2);
            chip.setAttribute('data-tooltip', names);
        }

        chip.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleReaction(emoji, itemId, chip.closest('.reaction-bar'));
        });

        return chip;
    }

    async function toggleReaction(emoji, itemId, bar) {
        var activeChip = bar.querySelector('.reaction-chip[data-emoji="' + emoji + '"]');
        var isActive = activeChip && activeChip.classList.contains('active');

        var API = window.API_BASE_URL || (
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:3001/api'
                : window.location.origin + '/api'
        );

        try {
            var res;
            if (isActive) {
                res = await fetch(API + '/reactions/' + itemId, {
                    method: 'DELETE',
                    credentials: 'include'
                });
            } else {
                res = await fetch(API + '/reactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ messageId: itemId, emoji: emoji })
                });
            }

            var json = await res.json();
            if (json.success && json.allReactions) {
                var summary = buildReactionSummary(json.allReactions);
                renderBarWithData(bar, itemId, summary);
            } else {
                window.createReactionBar(bar.parentElement, itemId);
            }
        } catch (e) {
            console.error('Error toggling reaction:', e);
        }
    }

    // ── Modal Emoji Picker ──────────────────────────────────────────────────
    var currentPickerOverlay = null;

    function openPickerModal(itemId, bar) {
        // Close any existing picker
        closePickerModal();

        // Create overlay
        var overlay = document.createElement('div');
        overlay.className = 'reaction-picker-overlay';
        overlay.dataset.itemId = itemId;

        // Create modal
        var modal = document.createElement('div');
        modal.className = 'reaction-picker-modal';

        // Header
        var header = document.createElement('div');
        header.className = 'reaction-picker-header';
        header.innerHTML = '<span class="reaction-picker-title">Escolha uma reação</span>';

        var closeBtn = document.createElement('button');
        closeBtn.className = 'reaction-picker-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closePickerModal();
        });
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // Category tabs
        var tabsContainer = document.createElement('div');
        tabsContainer.className = 'reaction-picker-tabs';

        EMOJI_CATEGORIES.forEach(function (cat, idx) {
            var tab = document.createElement('button');
            tab.className = 'reaction-picker-tab' + (idx === 0 ? ' active' : '');
            tab.dataset.category = cat.id;
            tab.innerHTML = '<span class="reaction-tab-icon">' + cat.icon + '</span>';
            tab.title = cat.label;
            tab.setAttribute('aria-label', cat.label);

            tab.addEventListener('click', function (e) {
                e.stopPropagation();
                // Update active tab
                tabsContainer.querySelectorAll('.reaction-picker-tab').forEach(function (t) {
                    t.classList.remove('active');
                });
                tab.classList.add('active');
                // Scroll to category
                var section = modal.querySelector('.reaction-picker-section[data-category="' + cat.id + '"]');
                if (section) {
                    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });

            tabsContainer.appendChild(tab);
        });
        modal.appendChild(tabsContainer);

        // Emoji grid (scrollable body)
        var body = document.createElement('div');
        body.className = 'reaction-picker-body';

        EMOJI_CATEGORIES.forEach(function (cat) {
            var section = document.createElement('div');
            section.className = 'reaction-picker-section';
            section.dataset.category = cat.id;

            var label = document.createElement('div');
            label.className = 'reaction-picker-category-label';
            label.textContent = cat.label;
            section.appendChild(label);

            var grid = document.createElement('div');
            grid.className = 'reaction-picker-grid';

            cat.emojis.forEach(function (emoji) {
                var btn = document.createElement('button');
                btn.className = 'reaction-picker-emoji';
                btn.textContent = emoji;
                btn.setAttribute('aria-label', 'Reagir com ' + emoji);

                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // Animate the selected emoji
                    btn.classList.add('selected');
                    toggleReaction(emoji, itemId, bar);
                    setTimeout(function () {
                        closePickerModal();
                    }, 200);
                });

                grid.appendChild(btn);
            });

            section.appendChild(grid);
            body.appendChild(section);
        });

        modal.appendChild(body);
        overlay.appendChild(modal);

        // Close on overlay click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                closePickerModal();
            }
        });

        // Close on Escape
        var escHandler = function (e) {
            if (e.key === 'Escape') {
                closePickerModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(overlay);
        currentPickerOverlay = overlay;

        // Trigger open animation
        requestAnimationFrame(function () {
            overlay.classList.add('open');
            modal.classList.add('open');
        });

        // Observe scroll to update active tab
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    var catId = entry.target.dataset.category;
                    tabsContainer.querySelectorAll('.reaction-picker-tab').forEach(function (t) {
                        t.classList.toggle('active', t.dataset.category === catId);
                    });
                }
            });
        }, { root: body, threshold: 0.5 });

        body.querySelectorAll('.reaction-picker-section').forEach(function (s) {
            observer.observe(s);
        });
    }

    function closePickerModal() {
        if (!currentPickerOverlay) return;
        var overlay = currentPickerOverlay;
        var modal = overlay.querySelector('.reaction-picker-modal');
        if (modal) modal.classList.remove('open');
        overlay.classList.remove('open');

        setTimeout(function () {
            if (overlay.parentNode) overlay.remove();
        }, 250);
        currentPickerOverlay = null;
    }

    /**
     * Utility: Initialize reactions on all visible notification items.
     */
    window.initReactionsForNotifications = function () {
        // Dashboard notification items
        document.querySelectorAll('.notif-item').forEach(function (item) {
            var id = item.dataset.notifId || item.dataset.id || 'notif-' + Array.prototype.indexOf.call(item.parentElement.children, item);
            if (!item.querySelector('.reaction-bar')) {
                window.createReactionBar(item.querySelector('.notif-body') || item, id);
            }
        });

        // Director notices
        document.querySelectorAll('.dnc-row').forEach(function (item) {
            var id = item.dataset.noticeId || item.dataset.id || 'notice-' + Array.prototype.indexOf.call(item.parentElement.children, item);
            if (!item.querySelector('.reaction-bar')) {
                window.createReactionBar(item, id);
            }
        });

        // Notification history
        document.querySelectorAll('.nd-preview-notif').forEach(function (item) {
            var id = item.dataset.previewId || 'preview-notif';
            if (!item.querySelector('.reaction-bar')) {
                window.createReactionBar(item, id);
            }
        });
    };

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(window.initReactionsForNotifications, 500);
        });
    } else {
        setTimeout(window.initReactionsForNotifications, 500);
    }

    // Re-init when new content is added
    var reactionObserver = new MutationObserver(function (mutations) {
        var shouldInit = false;
        mutations.forEach(function (m) {
            if (m.addedNodes.length > 0) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1 && (
                        node.classList.contains('notif-item') ||
                        node.classList.contains('dnc-row') ||
                        (node.querySelector && node.querySelector('.notif-item, .dnc-row'))
                    )) {
                        shouldInit = true;
                    }
                });
            }
        });
        if (shouldInit) {
            setTimeout(window.initReactionsForNotifications, 200);
        }
    });

    reactionObserver.observe(document.body, { childList: true, subtree: true });

})();
