// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/data-entry/form.html の inline script。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

document.addEventListener('DOMContentLoaded', () => {
    // Theme Toggler
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeToggleIcon = document.getElementById('theme-toggle-icon');

    // Check for saved theme in localStorage and apply it
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        if(themeToggleIcon) themeToggleIcon.textContent = 'dark_mode';
    } else {
        document.documentElement.classList.remove('dark');
        if(themeToggleIcon) themeToggleIcon.textContent = 'light_mode';
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            // Toggle the dark class on the root html element
            document.documentElement.classList.toggle('dark');

            // Update the icon and save the preference
            if (document.documentElement.classList.contains('dark')) {
                if(themeToggleIcon) themeToggleIcon.textContent = 'dark_mode';
                localStorage.setItem('theme', 'dark');
            } else {
                if(themeToggleIcon) themeToggleIcon.textContent = 'light_mode';
                localStorage.setItem('theme', 'light');
            }
        });
    }

    const accordions = document.querySelectorAll('.accordion-item');

    const allInputs = document.querySelectorAll('#accordion input, #accordion textarea');

    const openAccordion = (item) => {
        const content = item.querySelector('.accordion-content');
        const icon = item.querySelector('.accordion-header .material-icons');
        if (content && !content.classList.contains('open')) {
            content.classList.add('open');
            if (icon) icon.textContent = 'expand_less';
        }
    };

    const closeAccordion = (item) => {
        const content = item.querySelector('.accordion-content');
        const icon = item.querySelector('.accordion-header .material-icons');
        if (content && content.classList.contains('open')) {
            content.classList.remove('open');
            if (icon) icon.textContent = 'expand_more';
        }
    };

    accordions.forEach(item => {
        const header = item.querySelector('.accordion-header');
        if (header) {
            header.addEventListener('click', () => {
                const wasOpen = item.querySelector('.accordion-content').classList.contains('open');
                accordions.forEach(acc => closeAccordion(acc));
                if (!wasOpen) {
                    openAccordion(item);
                }
            });
        }
    });

    allInputs.forEach((input, index) => {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent form submission

                const nextInput = allInputs[index + 1];
                if (nextInput) {
                    const currentAccordion = event.target.closest('.accordion-item');
                    const nextAccordion = nextInput.closest('.accordion-item');

                    if (currentAccordion !== nextAccordion) {
                        closeAccordion(currentAccordion);
                        openAccordion(nextAccordion);
                    }
                    
                    nextInput.focus();
                }
            }
        });
    });

    // Open the first accordion by default
    if (accordions.length > 0) {
        openAccordion(accordions[0]);
    }

    // Modal
    const skipBtn = document.getElementById('skip-btn');
    const skipModal = document.getElementById('skip-modal');
    const cancelSkipBtn = document.getElementById('cancel-skip-btn');
    const confirmSkipBtn = document.getElementById('confirm-skip-btn');

    if (skipBtn && skipModal && cancelSkipBtn && confirmSkipBtn) {
        skipBtn.addEventListener('click', () => skipModal.classList.remove('hidden'));
        cancelSkipBtn.addEventListener('click', () => skipModal.classList.add('hidden'));
        confirmSkipBtn.addEventListener('click', () => {
            // Logic to handle skip confirmation would go here
            console.log('Skip confirmed');
            skipModal.classList.add('hidden');
        });
    }

    // Timer
    const timerElement = document.getElementById('timer');
    if (timerElement) {
        let seconds = 0;
        const targetSeconds = 3 * 60; // 3 minutes

        const timerInterval = setInterval(() => {
            seconds++;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;

            const formattedTime = 
                `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
            
            timerElement.textContent = formattedTime;

            if (seconds > targetSeconds) {
                timerElement.classList.add('expired');
            }
        }, 1000);
    }

    // Image Viewer
    const imageState = {
        "card-image-front": { zoom: 1, rotation: 0 },
        "card-image-back": { zoom: 1, rotation: 0 },
    };

    const mainImageWrapper = document.getElementById('main-image-wrapper');
    const thumbnailWrapper = document.getElementById('thumbnail-wrapper');
    
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const rotateLeftBtn = document.getElementById('rotate-left');
    const rotateRightBtn = document.getElementById('rotate-right');

    const updateTransform = (imageElement) => {
        const imageId = imageElement.id;
        if (imageState[imageId]) {
            imageElement.style.transform = `scale(${imageState[imageId].zoom}) rotate(${imageState[imageId].rotation}deg)`;
        }
    };

    thumbnailWrapper.addEventListener('click', () => {
        const mainImageContainer = mainImageWrapper.firstElementChild;
        const thumbnailImageContainer = thumbnailWrapper.firstElementChild;

        // Swap the containers
        mainImageWrapper.appendChild(thumbnailImageContainer);
        thumbnailWrapper.appendChild(mainImageContainer);

        // Update classes to reflect new roles
        mainImageContainer.classList.add('thumbnail-image');
        mainImageContainer.classList.remove('w-full', 'h-full');
        thumbnailImageContainer.classList.remove('thumbnail-image');
        thumbnailImageContainer.classList.add('w-full', 'h-full');
    });

    const applyControl = (callback) => {
        const mainImage = mainImageWrapper.querySelector('img');
        if (mainImage) {
            callback(mainImage);
            updateTransform(mainImage);
        }
    };

    zoomInBtn.addEventListener('click', () => {
        applyControl(img => imageState[img.id].zoom += 0.25);
    });

    zoomOutBtn.addEventListener('click', () => {
        applyControl(img => {
            if (imageState[img.id].zoom > 0.3) { // Prevent zooming out too much
                imageState[img.id].zoom -= 0.25;
            }
        });
    });

    rotateLeftBtn.addEventListener('click', () => {
        applyControl(img => imageState[img.id].rotation -= 90);
    });

    rotateRightBtn.addEventListener('click', () => {
        applyControl(img => imageState[img.id].rotation += 90);
    });
});
