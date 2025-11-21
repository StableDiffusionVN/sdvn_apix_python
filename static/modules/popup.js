export function setupHelpPopups({ buttonsSelector, overlayId, titleId, bodyId, closeBtnId, content }) {
    const overlay = document.getElementById(overlayId);
    const titleEl = document.getElementById(titleId);
    const bodyEl = document.getElementById(bodyId);
    const closeBtn = document.getElementById(closeBtnId);
    const buttons = document.querySelectorAll(buttonsSelector);

    if (!overlay || !titleEl || !bodyEl) return;

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.popupTarget;
            if (target) {
                showPopup(target);
            }
        });
    });

    closeBtn?.addEventListener('click', closePopup);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) {
            closePopup();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
            event.preventDefault();
            closePopup();
        }
    });

    function showPopup(type) {
        const popupContent = content[type];
        if (!popupContent) return;

        titleEl.textContent = popupContent.title;
        bodyEl.innerHTML = popupContent.sections
            .map(section => {
                const items = (section.items || []).map(item => `<li>${item}</li>`).join('');
                return `
                    <section class="popup-section">
                        <h3>${section.heading}</h3>
                        <ul>${items}</ul>
                    </section>
                `;
            })
            .join('');

        overlay.classList.remove('hidden');
    }

    function closePopup() {
        overlay.classList.add('hidden');
    }
}
