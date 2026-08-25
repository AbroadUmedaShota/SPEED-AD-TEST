// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/coupon-management.html の inline script。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

/**
 * クーポン管理ページの初期化とイベントハンドリング
 */

// ダミーデータ（APIからの取得を想定）
const dummyCoupons = [
    {
        id: 'c_001',
        code: 'SPRING25',
        name: '春の特別割引キャンペーン',
        discountRate: 10,
        validFrom: '2025-04-01T00:00:00Z',
        validTo: '2025-04-30T23:59:59Z',
        usageLimit: 100,
        usageCount: 25,
        status: 'ACTIVE',
        memo: '新規顧客獲得用のプロモーションコード',
        createdBy: 'admin_01',
        createdAt: '2025-03-20T10:00:00Z',
        updatedAt: '2025-03-20T10:00:00Z',
        usageLogs: Array.from({ length: 25 }, (_, j) => ({
            usedAt: new Date(Date.now() - (Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(),
            userId: `user_${Math.floor(Math.random() * 1000)}`,
            orderId: `order_${Math.random().toString(36).substr(2, 9)}`
        })),
    },
    {
        id: 'c_002',
        code: 'PRIVATE_USER_A',
        name: '特定ユーザーA様向けクーポン',
        discountRate: 20,
        validFrom: '2025-04-10T00:00:00Z',
        validTo: '2025-05-10T23:59:59Z',
        usageLimit: 1,
        usageCount: 1,
        status: 'LIMIT_REACHED',
        memo: 'ロイヤルカスタマー向け',
        createdBy: 'admin_02',
        createdAt: '2025-04-09T15:30:00Z',
        updatedAt: '2025-04-15T11:00:00Z',
        usageLogs: [{
            usedAt: '2025-04-15T11:00:00Z',
            userId: 'user_123',
            orderId: 'order_abc'
        }],
    },
];

// Generate more dummy data to reach 100 coupons
for (let i = 3; i <= 100; i++) {
    const status_options = ['ACTIVE', 'LIMIT_REACHED', 'INACTIVE', 'EXPIRED'];
    const status = status_options[i % status_options.length];
    const usageLimit = (i % 10 === 0) ? -1 : 100;
    const usageCount = Math.floor(Math.random() * 100);
    const usageLogs = [];
    for (let j = 0; j < usageCount; j++) {
        usageLogs.push({
            usedAt: new Date(Date.now() - (Math.random() * 30 * 24 * 60 * 60 * 1000)).toISOString(),
            userId: `user_${Math.floor(Math.random() * 1000)}`,
            orderId: `order_${Math.random().toString(36).substr(2, 9)}`
        });
    }

    dummyCoupons.push({
        id: `c_${String(i).padStart(3, '0')}`,
        code: `DUMMYCODE-${i}`,
        name: `ダミーキャンペーン ${i}`,
        discountRate: (i % 50) + 1,
        validFrom: `2025-01-01T00:00:00Z`,
        validTo: `2025-12-31T23:59:59Z`,
        usageLimit: usageLimit,
        usageCount: usageCount,
        status: status,
        memo: `ダミーデータ ${i}`,
        createdBy: `admin_${i % 3 + 1}`,
        createdAt: new Date(Date.now() - (100-i) * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        usageLogs: usageLogs,
    });
}


let allCoupons = [];
let displayedCoupons = [];
let lastNewCouponData = null;

// 状態管理
const state = {
    currentPage: 1,
    itemsPerPage: 50, // Default to 50
    sortKey: 'createdAt',
    sortDirection: 'desc',
    filters: { keyword: '', status: '', dateStart: '', dateEnd: '' },
};

// --- DOM要素 ---
const getElement = (id) => document.getElementById(id);
const tableBody = getElement('coupon-list-body');
const searchForm = getElement('couponSearchForm');
const itemsPerPageSelect = getElement('itemsPerPageSelect');
const paginationInfo = getElement('pagination-info');
const paginationControls = getElement('pagination-controls');
const newCouponButton = getElement('newCouponButton');
const bulkCreateCouponButton = getElement('bulkCreateCouponButton');

/**
 *メインの初期化関数
 */
export function initCouponManagementPage() {
    allCoupons = [...dummyCoupons];
    setupEventListeners();
    updateAndRender();
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
    getElement('searchAccordionHeader').addEventListener('click', () => {
        const content = getElement('searchAccordionContent');
        const icon = getElement('searchAccordionIcon');
        const isHidden = content.classList.toggle('hidden');
        icon.textContent = isHidden ? 'expand_more' : 'expand_less';
    });

    searchForm.addEventListener('submit', e => {
        e.preventDefault();
        state.filters.keyword = getElement('searchKeyword').value;
        state.filters.status = getElement('searchStatus').value;
        state.filters.dateStart = getElement('searchDateStart').value;
        state.filters.dateEnd = getElement('searchDateEnd').value;
        state.currentPage = 1;
        updateAndRender();
    });

    searchForm.addEventListener('reset', () => {
        setTimeout(() => { 
            Object.keys(state.filters).forEach(key => state.filters[key] = ''); 
            state.currentPage = 1; 
            updateAndRender(); 
        }, 0);
    });

    itemsPerPageSelect.addEventListener('change', e => {
        state.itemsPerPage = parseInt(e.target.value, 10);
        state.currentPage = 1;
        updateAndRender();
    });

    document.querySelector('#coupon-list-body').previousElementSibling.addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !th.dataset.sortKey) return;
        const key = th.dataset.sortKey;
        if (state.sortKey === key) {
            state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortKey = key;
            state.sortDirection = 'desc';
        }
        updateAndRender();
    });

    getElement('sendEmailButton').addEventListener('click', () => handleOpenModal('sendEmailModal', 'modals/sendEmailModal.html', setupSendEmailModal));
    newCouponButton.addEventListener('click', () => handleOpenModal('newCouponModal', 'modals/newCouponModal.html', setupNewCouponModal));
    bulkCreateCouponButton.addEventListener('click', () => handleOpenModal('bulkCreateCouponModal', 'modals/bulkCreateCouponModal.html', setupBulkCreateCouponModal));

    tableBody.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (!button) return;
        const couponId = button.dataset.couponId;
        const coupon = allCoupons.find(c => c.id === couponId);
        if (!coupon) return;

        if (button.classList.contains('detail-btn')) {
            handleOpenModal('couponDetailModal', 'modals/couponDetailModal.html', (close) => setupCouponDetailModal(coupon, close));
        } else if (button.classList.contains('edit-btn')) {
            handleOpenModal('editCouponModal', 'modals/editCouponModal.html', (close) => setupEditCouponModal(coupon, close));
        } else if (button.classList.contains('delete-btn')) {
            const modalOptions = {
                title: 'クーポン削除',
                message: `本当にクーポン「${coupon.name}」を削除しますか？この操作は元に戻せません。`,
                confirmText: '削除',
                onConfirm: () => {
                    allCoupons = allCoupons.filter(item => item.id !== couponId);
                    updateAndRender();
                    showToast('クーポンを削除しました。');
                }
            };
            handleOpenModal('confirmationModal', 'modals/confirmationModal.html', (close) => setupConfirmationModal(modalOptions, close));
        }
    });
}

function updateAndRender() {
    let filtered = allCoupons.filter(c => {
        const keyword = state.filters.keyword.toLowerCase();
        return (!keyword || c.code.toLowerCase().includes(keyword) || c.name.toLowerCase().includes(keyword)) &&
               (!state.filters.status || c.status === state.filters.status) &&
               (!state.filters.dateStart || c.validTo >= state.filters.dateStart) && 
               (!state.filters.dateEnd || c.validFrom <= state.filters.dateEnd);
    });

    filtered.sort((a, b) => (a[state.sortKey] > b[state.sortKey] ? 1 : -1) * (state.sortDirection === 'asc' ? 1 : -1));
    
    displayedCoupons = filtered;
    const total = displayedCoupons.length;
    const pages = Math.ceil(total / state.itemsPerPage);
    state.currentPage = Math.max(1, Math.min(state.currentPage, pages));
    const start = (state.currentPage - 1) * state.itemsPerPage;
    const end = start + state.itemsPerPage;
    
    renderTable(displayedCoupons.slice(start, end));
    renderPagination(total, pages, start, end);
}

function renderTable(coupons) {
    tableBody.innerHTML = '';
    if (coupons.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-on-surface-variant">該当なし</td></tr>`;
        return;
    }
    coupons.forEach(c => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-surface-container-highest';
        row.innerHTML = `
            <td class="px-4 py-3 whitespace-nowrap">${escapeHTML(c.code)}</td>
            <td class="px-4 py-3 whitespace-nowrap">${escapeHTML(c.name)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">${c.discountRate}%</td>
            <td class="px-4 py-3 whitespace-nowrap text-right">${new Date(c.validTo).toLocaleDateString()}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">${c.usageCount} / ${c.usageLimit === -1 ? '∞' : c.usageLimit}</td>
            <td class="px-4 py-3 whitespace-nowrap text-left"><span class="status-badge status-${c.status.toLowerCase()}">${getStatusText(c.status)}</span></td>
            <td class="px-4 py-3 text-left whitespace-nowrap">
                <button class="detail-btn border border-outline hover:bg-surface-container text-on-surface text-xs font-semibold px-3 py-1 rounded-full" data-coupon-id="${c.id}">詳細</button>
                <button class="edit-btn border border-outline hover:bg-surface-container text-on-surface text-xs font-semibold px-3 py-1 rounded-full ml-2" data-coupon-id="${c.id}">編集</button>
                <button class="delete-btn bg-red-600 text-white text-xs font-semibold px-3 py-1 rounded-full ml-2" data-coupon-id="${c.id}">削除</button>
            </td>`;
        tableBody.appendChild(row);
    });
}

function renderPagination(total, pages, start, end) {
    paginationInfo.textContent = `${total}件中 ${total > 0 ? start + 1 : 0}〜${Math.min(end, total)}件を表示`;
    paginationControls.innerHTML = '';

    // ページが1以下の場合は、ページネーションコントロールを非表示にしない
    // ただし、ページ番号ボタンは生成されないため、実質的に矢印ボタンのみが表示される
    // または、何も表示しない（ユーザーの意図による）
    // 今回は、ページ番号ボタンが生成されないため、矢印ボタンのみが表示される状態にする

    const createButton = (content, page, disabled = false, active = false) => {
        const btn = document.createElement('button');
        btn.innerHTML = content;
        btn.disabled = disabled;
        let classes = 'p-1 rounded-full disabled:opacity-50';
        if (typeof content === 'number') {
            classes = `w-8 h-8 flex items-center justify-center rounded-lg text-sm ${active ? 'bg-primary text-white' : 'hover:bg-surface-container'}`;
        }
        btn.className = classes;
        if (page) {
            btn.addEventListener('click', () => { state.currentPage = page; updateAndRender(); });
        }
        return btn;
    };
    
    const createEllipsis = () => {
        const span = document.createElement('span');
        span.textContent = '...';
        span.className = 'w-8 h-8 flex items-center justify-center text-sm';
        return span;
    };

    paginationControls.appendChild(createButton('<span class="material-icons text-base">chevron_left</span>', state.currentPage - 1, state.currentPage === 1));

    const getPageNumbers = () => {
        const totalNumbers = 5; // 表示するページ番号の最大数 (奇数を推奨)
        const totalBlocks = totalNumbers + 2; // ページ番号 + 省略記号

        if (pages <= totalBlocks) {
            return Array.from({ length: pages }, (_, i) => i + 1);
        }

        const result = new Set();
        const currentPage = state.currentPage;

        result.add(1);

        if (currentPage > 3) {
            result.add('...');
        }

        const wingSize = Math.floor(totalNumbers / 2);
        for (let i = -wingSize; i <= wingSize; i++) {
            const page = currentPage + i;
            if (page > 1 && page < pages) {
                result.add(page);
            }
        }
        
        if (currentPage < pages - 2) {
            result.add('...');
        }

        result.add(pages);
        return Array.from(result);
    };

    getPageNumbers().forEach(pageNumber => {
        if (typeof pageNumber === 'string') {
            paginationControls.appendChild(createEllipsis());
        } else {
            paginationControls.appendChild(createButton(pageNumber, pageNumber, false, pageNumber === state.currentPage));
        }
    });


    paginationControls.appendChild(createButton('<span class="material-icons text-base">chevron_right</span>', state.currentPage + 1, state.currentPage === pages));
}

async function handleOpenModal(modalId, url, callback) {
    const placeholder = getElement(`${modalId}Placeholder`);
    if (!placeholder) return;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Modal load failed');
        placeholder.innerHTML = await response.text();
        const modal = placeholder.querySelector('.fixed');
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modal.children[0].classList.remove('scale-95');
        const close = () => {
            modal.classList.add('opacity-0', 'pointer-events-none');
            modal.children[0].classList.add('scale-95');
            setTimeout(() => { placeholder.innerHTML = '' }, 300);
        };
        modal.querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', close));
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        if (callback) callback(close);
    } catch (err) {
        showToast('モーダル読込失敗', 'error');
    }
}

function setupNewCouponModal(closeModal) {
    const form = getElement('newCouponForm');
    const today = new Date().toISOString().split('T')[0];

    if (lastNewCouponData) {
        Object.keys(lastNewCouponData).forEach(key => {
            const input = form.elements[key];
            if (input && key !== 'code') {
                if (input.type === 'checkbox') {
                    input.checked = lastNewCouponData[key];
                } else {
                    input.value = lastNewCouponData[key];
                }
            }
        });
    } else {
        form.elements.validFrom.value = today;
        form.elements.validTo.value = today;
    }

    const unlimited = getElement('unlimitedUsage');
    const usageLimit = getElement('newCouponUsageLimit');
    unlimited.addEventListener('change', () => { usageLimit.disabled = unlimited.checked; if (unlimited.checked) usageLimit.value = ''; });
    if(form.elements['unlimitedUsage'].checked) usageLimit.disabled = true;

    getElement('generateCouponCode').addEventListener('click', () => { getElement('newCouponCode').value = `CPN-${Date.now().toString(36).toUpperCase()}`; });
    
    form.addEventListener('submit', e => {
        e.preventDefault();
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        if (new Date(data.validTo) < new Date(data.validFrom)) return showToast('終了日は開始日より後に設定してください', 'error');
        if (allCoupons.some(c => c.code === data.code)) return showToast('そのクーポンコードは既に使用されています', 'error');
        
        lastNewCouponData = data; // Save form data

        const newCoupon = { 
            ...data, 
            id: `c_${Date.now()}`,
            usageLimit: unlimited.checked ? -1 : parseInt(data.usageLimit, 10),
            usageCount: 0,
            status: 'ACTIVE', 
            createdAt: new Date().toISOString(), 
            updatedAt: new Date().toISOString()
        };
        allCoupons.unshift(newCoupon);
        updateAndRender();
        showToast('クーポンが正常に作成されました。');
        closeModal();
    });
}

function setupCouponDetailModal(coupon, closeModal) {
    Object.keys(coupon).forEach(key => {
        const el = getElement(`detail-${key}`);
        if (el) {
            if (key === 'validFrom' || key === 'validTo') {
                el.textContent = new Date(coupon[key]).toLocaleDateString();
            } else {
                el.textContent = coupon[key] || '-';
            }
        }
    });

    getElement('detail-usage').textContent = `${coupon.usageCount} / ${coupon.usageLimit === -1 ? '∞' : coupon.usageLimit}`;
    getElement('detail-status').innerHTML = `<span class="status-badge status-${coupon.status.toLowerCase()}">${getStatusText(coupon.status)}</span>`;

    const logBody = getElement('detail-log-body');
    logBody.innerHTML = '';
    if (coupon.usageLogs && coupon.usageLogs.length > 0) {
        coupon.usageLogs.forEach(log => {
            const row = logBody.insertRow();
            row.innerHTML = `
                <td class="px-4 py-2">${new Date(log.usedAt).toLocaleString()}</td>
                <td class="px-4 py-2">${escapeHTML(log.userId)}</td>
                <td class="px-4 py-2">${escapeHTML(log.orderId)}</td>
            `;
        });
    } else {
        logBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-on-surface-variant">利用ログはありません</td></tr>';
    }

    getElement('deactivateCouponButton').addEventListener('click', () => {
        if (confirm('本当にこのクーポンを停止しますか？')) { 
            coupon.status = 'INACTIVE'; 
            updateAndRender(); 
            showToast('クーポンを停止しました。'); 
            closeModal(); 
        }
    });
}

function setupEditCouponModal(coupon, closeModal) {
    const form = getElement('editCouponForm');
    Object.keys(coupon).forEach(key => {
        const input = form.elements[key];
        if (input) {
            if (input.type === 'date') {
                input.value = new Date(coupon[key]).toISOString().split('T')[0];
            } else if (key === 'usageLimit' && coupon[key] === -1) {
                input.value = ''; // Set to empty string if unlimited
            } else {
                input.value = coupon[key];
            }
        }
    });
    const unlimited = getElement('editUnlimitedUsage');
    unlimited.checked = coupon.usageLimit === -1;
    getElement('editCouponUsageLimit').disabled = unlimited.checked;
    unlimited.addEventListener('change', () => {
        const usageLimitInput = getElement('editCouponUsageLimit');
        usageLimitInput.disabled = unlimited.checked;
        if (unlimited.checked) {
            usageLimitInput.value = '';
        }
    });

    form.addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        if (new Date(data.validTo) < new Date(data.validFrom)) return showToast('終了日は開始日より後に設定してください', 'error');
        
        Object.assign(coupon, { 
            ...data, 
            usageLimit: unlimited.checked ? -1 : parseInt(data.usageLimit, 10), 
            updatedAt: new Date().toISOString() 
        });
        updateAndRender();
        showToast('クーポンが正常に更新されました。');
        closeModal();
    });
}

function setupBulkCreateCouponModal(closeModal) {
    let step = 1;
    let bulkData = { common: {}, individuals: [] };
    const form = getElement('bulkCreateForm-step1');
    const today = new Date().toISOString().split('T')[0];
    form.elements.validFrom.value = today;
    form.elements.validTo.value = today;

    const unlimited = getElement('bulkUnlimitedUsage');
    const usageLimit = getElement('bulkCouponUsageLimit');
    unlimited.addEventListener('change', () => { 
        usageLimit.disabled = unlimited.checked; 
        if (unlimited.checked) usageLimit.value = '';
        usageLimit.required = !unlimited.checked;
    });

    const goToStep = (s) => {
        step = s;
        [1, 2, 3].forEach(i => getElement(`bulk-step-${i}`).classList.toggle('hidden', i !== step));
        getElement('bulk-prev-btn').classList.toggle('hidden', step === 1 || step === 3);
        getElement('bulk-next-btn').classList.toggle('hidden', step !== 1);
        getElement('bulk-create-btn').classList.toggle('hidden', step !== 2);
        if (step === 3) {
            getElement('bulk-create-btn').parentElement.previousElementSibling.querySelector('button').classList.add('hidden');
            getElement('bulk-next-btn').classList.add('hidden');
        }
    };

    const nextBtn = getElement('bulk-next-btn');
    const createBtn = getElement('bulk-create-btn');

    nextBtn.addEventListener('click', () => {
        if (step === 1) {
            if (!form.checkValidity()) return form.reportValidity();
            bulkData.common = Object.fromEntries(new FormData(form).entries());
            const quantity = parseInt(bulkData.common.quantity, 10);
            if (isNaN(quantity) || quantity <= 0) return showToast('作成件数は1以上で入力してください', 'error');
            
            bulkData.individuals = [];
            for(let i = 0; i < quantity; i++) {
                bulkData.individuals.push({ 
                    code: `CPN-${Date.now().toString(36).toUpperCase()}-${i}`,
                    name: 'プロモーションクーポン' 
                });
            }

            getElement('bulk-preview-body').innerHTML = bulkData.individuals.map((d, i) => `<tr><td class="p-2"><input class="form-input text-on-surface placeholder:text-on-surface-variant" data-index="${i}" name="code" value="${d.code}"></td><td class="p-2"><input class="form-input text-on-surface placeholder:text-on-surface-variant" data-index="${i}" name="name" value="${d.name}"></td></tr>`).join('');
            goToStep(2);
        }
    });

    createBtn.addEventListener('click', () => {
        getElement('bulk-preview-body').querySelectorAll('input').forEach(input => {
            const index = parseInt(input.dataset.index, 10);
            bulkData.individuals[index][input.name] = input.value;
        });

        const unlimited = getElement('bulkUnlimitedUsage').checked;
        const newCoupons = bulkData.individuals.map(ind => ({
            ...bulkData.common,
            ...ind,
            id: `c_${Date.now()}_${Math.random()}`,
            usageLimit: unlimited ? -1 : parseInt(bulkData.common.usageLimit, 10),
            usageCount: 0,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }));
        allCoupons.unshift(...newCoupons);
        getElement('bulk-success-count').textContent = newCoupons.length;
        updateAndRender();
        goToStep(3);
    });

    getElement('bulk-csv-download').addEventListener('click', () => {
        const csvHeader = ["code", "name"].join(',');
        const csvRows = bulkData.individuals.map(i => [i.code, i.name].join(','));
        const csvContent = [csvHeader, ...csvRows].join('');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'coupons.csv';
        link.click();
    });

    getElement('bulk-prev-btn').addEventListener('click', () => goToStep(step - 1));
}

// --- ユーティリティ関数 ---
function getStatusText(status) {
    const map = { ACTIVE: '有効', LIMIT_REACHED: '利用上限到達', INACTIVE: '利用停止', EXPIRED: '期限切れ' };
    return map[status] || status;
}

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>' "]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

function showToast(message, type = 'success') {
    const container = getElement('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `text-white px-4 py-3 rounded-lg shadow-lg transition-all duration-300 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
    toast.innerHTML = `<span class="font-semibold">${type === 'success' ? '成功' : 'エラー'}:</span> ${escapeHTML(message)}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.addEventListener('transitionend', () => toast.remove()); }, 3000);
}

function setupSendEmailModal(closeModal) {
    const form = getElement('sendEmailForm');
    const recipientsContainer = getElement('emailRecipientsContainer');
    const addRecipientButton = getElement('addRecipientButton');
    const templateSelect = getElement('emailTemplateSelect');
    const emailBody = getElement('emailBody');
    const emailSubject = getElement('emailSubject');
    const insertCompanyName = getElement('insertCompanyName');
    const insertCouponCode = getElement('insertCouponCode');
    const saveAsTemplateButton = getElement('saveAsTemplateButton');

    // --- カスタムクーポン選択プルダウンのロジック ---
    const customDropdown = getElement('customCouponDropdown');
    const dropdownButton = getElement('customDropdownButton');
    const selectedCouponText = getElement('selectedCouponText');
    const dropdownOptions = getElement('customDropdownOptions');
    const emailCouponSearch = getElement('emailCouponSearch');
    const couponOptionsList = getElement('couponOptionsList');
    const hiddenInput = getElement('emailTargetCoupon');

    // オプションリストのレンダリング
    const renderCouponOptions = (coupons) => {
        couponOptionsList.innerHTML = '';
        coupons.forEach(coupon => {
            const li = document.createElement('li');
            li.className = 'px-4 py-2 text-sm text-on-surface hover:bg-surface-container cursor-pointer';
            li.textContent = `${coupon.code} - ${coupon.name}`;
            li.dataset.id = coupon.id;
            li.dataset.text = `${coupon.code} - ${coupon.name}`;
            couponOptionsList.appendChild(li);
        });
    };

    renderCouponOptions(allCoupons); // 初期表示

    // プルダウンの開閉
    dropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownOptions.classList.toggle('hidden');
    });

    // 外側クリックで閉じる
    document.addEventListener('click', (e) => {
        if (!customDropdown.contains(e.target)) {
            dropdownOptions.classList.add('hidden');
        }
    });

    // 検索機能
    emailCouponSearch.addEventListener('input', () => {
        const searchTerm = emailCouponSearch.value.toLowerCase();
        const allOptions = couponOptionsList.querySelectorAll('li');
        allOptions.forEach(option => {
            const text = option.textContent.toLowerCase();
            option.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    // オプション選択
    couponOptionsList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
            selectedCouponText.textContent = e.target.dataset.text;
            hiddenInput.value = e.target.dataset.id;
            dropdownOptions.classList.add('hidden');
            dropdownButton.classList.remove('placeholder:text-on-surface-variant');
        }
    });

    // --- ここまでカスタムプルダウンのロジック ---

    // 2. 送付先追加機能
    addRecipientButton.addEventListener('click', () => {
        const newRecipient = document.createElement('div');
        const recipientId = `recipient-${Date.now()}-${Math.floor(Math.random() * 1000)}`; // ユニークIDを生成
        newRecipient.className = 'flex items-center gap-2';
        newRecipient.dataset.recipientId = recipientId; // data属性を追加
        newRecipient.innerHTML = `
            <input type="email" name="recipients[]" class="form-input flex-grow" placeholder="recipient@example.com" required>
            <button type="button" class="remove-recipient-btn w-8 h-8 flex items-center justify-center rounded-full bg-error-container text-on-error-container hover:opacity-90" data-recipient-target="${recipientId}">
                <span class="material-icons text-base">remove</span>
            </button>
        `;
        recipientsContainer.appendChild(newRecipient);
        console.log('[setupSendEmailModal] Recipient added. Current recipients container HTML:', recipientsContainer.innerHTML);
    });

    console.log('[setupSendEmailModal] Attaching click listener to recipientsContainer for removal.');
    recipientsContainer.addEventListener('click', e => {
        console.log('[setupSendEmailModal] recipientsContainer click event fired. Target:', e.target);
        const removeButton = e.target.closest('.remove-recipient-btn');
        if (removeButton) {
            console.log('[setupSendEmailModal] remove-recipient-btn clicked:', removeButton);
            const targetRecipientId = removeButton.dataset.recipientTarget; // data属性からIDを取得
            const recipientElement = recipientsContainer.querySelector(`[data-recipient-id="${targetRecipientId}"]`); // そのIDを持つ要素を探す
            if (recipientElement) {
                console.log('[setupSendEmailModal] Recipient element to remove:', recipientElement);
                recipientElement.remove();
                console.log('[setupSendEmailModal] Recipient removed. Updated recipients container HTML:', recipientsContainer.innerHTML);
            } else {
                console.warn('[setupSendEmailModal] Could not find recipient element with ID to remove.');
            }
        }
    });

    // 3. テンプレート適用機能
    let templates = {
        template1: "{{company_name}}様\n\nいつもご利用いただきありがとうございます。\n感謝の気持ちを込めて、特別なクーポンをご用意しました。\nクーポンコード: {{coupon_code}}\n\nぜひこの機会にご利用ください。",
        template2: "{{company_name}}様\n\nはじめまして！\n新規登録ありがとうございます。初回限定でご利用いただけるクーポンをお届けします。\nクーポンコード: {{coupon_code}}\n\n皆様のご利用を心よりお待ちしております。",
        template3: "{{company_name}}様\n\n【特別オファー】\n今だけの特別なご案内です。\nこちらのクーポンをご利用いただくと、特別な割引が適用されます。\nクーポンコード: {{coupon_code}}\n\n有効期限が迫っておりますので、お早めにご利用ください。"
    };

    templateSelect.addEventListener('change', () => {
        const selectedTemplate = templates[templateSelect.value];
        if (selectedTemplate) {
            emailBody.value = selectedTemplate;
        }
    });

    // 4. 変数挿入機能
    const insertVariable = (variable) => {
        const start = emailBody.selectionStart;
        const end = emailBody.selectionEnd;
        const text = emailBody.value;
        emailBody.value = text.substring(0, start) + `{{${variable}}}` + text.substring(end);
        emailBody.focus();
        emailBody.selectionEnd = start + `{{${variable}}}`.length;
    };

    insertCompanyName.addEventListener('click', () => insertVariable('company_name'));
    insertCouponCode.addEventListener('click', () => insertVariable('coupon_code'));

    // 5. テンプレートとして登録機能
    saveAsTemplateButton.addEventListener('click', () => {
        const subject = emailSubject.value.trim();
        const body = emailBody.value.trim();

        if (!subject) {
            showToast('テンプレート名として使用するため、件名を入力してください。', 'error');
            return;
        }
        if (!body) {
            showToast('テンプレートとして登録する本文を入力してください。', 'error');
            return;
        }

        const newTemplateId = `custom_template_${Date.now()}`;
        templates[newTemplateId] = body;
        
        const newOption = document.createElement('option');
        newOption.value = newTemplateId;
        newOption.textContent = subject;
        templateSelect.appendChild(newOption);

        newOption.selected = true;

        showToast(`テンプレート「${subject}」を登録しました。`);
    });

    // 6. フォーム送信処理
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!hiddenInput.value) {
            showToast('対象クーポンを選択してください。', 'error');
            return;
        }
        // ここで実際のメール送信APIを呼び出す
        showToast('メールを送信しました。');
        closeModal();
    });
}

function setupConfirmationModal(options, closeModal) {
    const { title, message, confirmText, onConfirm } = options;

    getElement('confirmationModalTitle').textContent = title;
    getElement('confirmationModalMessage').textContent = message;
    
    const confirmButton = getElement('confirmActionButton');
    confirmButton.textContent = confirmText;

    // 既存のイベントリスナーを削除して、多重実行を防ぐ
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);

    newConfirmButton.addEventListener('click', () => {
        onConfirm();
        closeModal();
    });
}