// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/operator-management.html の inline script。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

/**
 * operator-management.js
 * Operator management page specific javascript
 */
import { debounce, showToast } from '../../02_dashboard/src/utils.js';
import { showConfirmationModal } from '../../02_dashboard/src/confirmationModal.js';

// --- DUMMY DATA & CONFIG ---
// const affiliations = ['社内', 'Abroad']; // MOCK_GROUPSを使用するため削除
const roles = ['オペレーター(Lv1)', 'オペレーター管理者(Lv2)', 'Abroadスタッフ(Lv3)', 'Abroadマネージャー(Lv4)'];
const statuses = ['active', 'suspended'];
const firstNames = ['太郎', '花子', '次郎', '三郎', '陽葵', '凛', '蒼', '蓮', '湊', '結衣'];
const lastNames = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤'];
const groups = ['A', 'B', 'C']; // これはダミーグループで、MOCK_GROUPSとは別なので残しておく
const languages = ['日本語', '英語', '中国語', 'ベトナム語'];

let MOCK_GROUPS = [ // MOCK_GROUPS の定義を移動
    { id: 1, name: '東京営業部' },
    { id: 2, name: '大阪支社' },
    { id: 3, name: '開発チーム' },
    { id: 4, name: 'マーケティング部' },
    { id: 5, name: 'サポート' },
];

// ヘルパー関数: MOCK_GROUPSから<option>タグのHTMLを生成
function getGroupOptionsHtml(selectedGroupName = null) {
    return MOCK_GROUPS.map(group => `
        <option value="${group.name}" ${selectedGroupName === group.name ? 'selected' : ''}>${group.name}</option>
    `).join('');
}

const randomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));

let dummyOperators = [];
let opCounter = 0;
let abCounter = 0;

for (let i = 1; i <= 200; i++) {
    const affiliation = MOCK_GROUPS[Math.floor(Math.random() * MOCK_GROUPS.length)].name; // affiliation を MOCK_GROUPS から取得
    let id;
    if (affiliation.includes('Abroad')) { // Abroadを含むグループ名で判定
        abCounter++;
        id = `ab-${String(abCounter).padStart(3, '0')}`;
    } else {
        opCounter++;
        id = `op-${String(opCounter).padStart(3, '0')}`;
    }

    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    let role;
    if (affiliation.includes('Abroad')) {
        role = roles[Math.floor(Math.random() * 2) + 2];
    } else {
        role = roles[Math.floor(Math.random() * 2)];
    }

    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const group = groups[Math.floor(Math.random() * groups.length)]; // このgroupはダミーグループなのでそのまま
    const totalCompleted = Math.floor(Math.random() * 1000) + 50;

    const operatorLanguages = [];
    const numLanguages = Math.floor(Math.random() * 2) + 1;
    const shuffledLanguages = [...languages].sort(() => 0.5 - Math.random());
    for (let j = 0; j < numLanguages; j++) {
        operatorLanguages.push(shuffledLanguages[j]);
    }

    dummyOperators.push({
        id: id,
        name: `${lastName} ${firstName}`,
        email: `user${i}@example.com`,
        affiliation: affiliation,
        role: role,
        group: group,
        status: status,
        registrationDate: randomDate(new Date(2023, 0, 1), new Date()).toISOString().split('T')[0],
        lastLoginDate: randomDate(new Date(2023, 0, 1), new Date()).toISOString().split('T')[0],
        totalCompleted: totalCompleted,
        languages: operatorLanguages,
    });
}

const dummyHistory = [
    { type: '権限変更', actor: '田中 太郎', message: '山田 向日葵の権限を「オペレーター管理者(Lv2)」に変更しました。', timestamp: '2025/10/30 09:15', color: 'blue-500' },
    { type: '新規招待', actor: '佐藤 花子', message: '新規オペレーター (a.suzuki@example.com) を招待しました。', timestamp: '2025/10/29 17:40', color: 'purple-500' },
    { type: '削除', actor: 'システム管理者', message: 'オペレーター「伊藤 三郎」を削除しました。', timestamp: '2025/10/29 15:20', color: 'red-500' },
    { type: '情報変更', actor: '田中 太郎', message: 'オペレーター「渡辺 陽葵」の所属を「Abroad」に変更しました。', timestamp: '2025/10/28 11:05', color: 'blue-500' },
    { type: '新規招待', actor: '佐藤 花子', message: '新規オペレーター (y.watanabe@example.com) を招待しました。', timestamp: '2025/10/28 10:00', color: 'purple-500' },
    { type: '権限変更', actor: 'システム管理者', message: '中村 凛の権限を「オペレーター(Lv1)」に変更しました。', timestamp: '2025/10/27 18:00', color: 'blue-500' },
    { type: '削除', actor: 'システム管理者', message: 'オペレーター「小林 蒼」を削除しました。', timestamp: '2025/10/27 14:30', color: 'red-500' },
    { type: '新規招待', actor: '田中 太郎', message: '新規オペレーター (s.kobayashi@example.com) を招待しました。', timestamp: '2025/10/26 09:00', color: 'purple-500' },
    { type: '情報変更', actor: '佐藤 花子', message: 'オペレーター「加藤 蓮」のメールアドレスを変更しました。', timestamp: '2025/10/25 16:20', color: 'blue-500' },
    { type: '権限変更', actor: '田中 太郎', message: '山本 湊の権限を「オペレーター管理者(Lv2)」に変更しました。', timestamp: '2025/10/25 10:10', color: 'blue-500' },
];

let currentPage = 1;
let rowsPerPage = 25;
let filteredOperators = [...dummyOperators];
let sortState = { key: null, direction: 'none' };
let applyFiltersAndSearch;

function displayTablePage() {
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedOperators = filteredOperators.slice(start, end);
    renderOperatorTable(paginatedOperators);
    updateSortIcons();
    updatePaginationUI();
}

function renderHistory(history) {
    const panelContent = document.getElementById('history-panel-content');
    if (!panelContent) return;
    // Show latest history first
    panelContent.innerHTML = [...history].reverse().map(item => `
        <div class="border-l-4 border-${item.color} pl-3 py-1">
            <p class="font-semibold text-on-surface text-sm">${item.type}</p>
            <p class="text-on-surface-variant text-sm">${item.message}</p>
            <p class="text-xs text-on-surface-variant/70 mt-1">${item.timestamp}</p>
        </div>
    `).join('');
}

function getStatusBadge(status) {
    switch (status) {
        case 'active': return '<span class="status-badge bg-green-100 text-green-800">有効</span>';
        case 'suspended': return '<span class="status-badge bg-gray-200 text-gray-700">無効</span>';
        default: return '';
    }
}

function renderOperatorTable(operators) {
    const tableBody = document.getElementById('operator-table-body');
    if (!tableBody) return;
    if (operators.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-on-surface-variant">該当するオペレーターが見つかりません。</td></tr>`;
        return;
    }
    tableBody.innerHTML = operators.map(op => `
        <tr class="hover:bg-surface-variant/60" data-operator-id="${op.id}">
            <td class="w-12 px-4 py-3 text-center"><input type="checkbox" class="row-checkbox form-checkbox" data-operator-id="${op.id}"></td>
            <td class="px-4 py-3 font-medium text-on-surface">${op.name}</td>
            <td class="px-4 py-3 text-on-surface-variant">${op.email}</td>
            <td class="w-48 px-4 py-3 text-on-surface-variant">${op.role}</td>
            <td class="px-4 py-3 text-on-surface-variant">${op.affiliation}</td> <!-- 所属グループを追加 -->
            <td class="w-32 px-4 py-3 text-on-surface-variant text-left">${op.totalCompleted}</td>
            <td class="w-32 px-4 py-3 text-on-surface-variant">${getStatusBadge(op.status)}</td>
            <td class="w-40 px-4 py-3 text-center space-x-1">
                <button class="action-btn detail-btn border border-outline-variant bg-surface text-on-surface-variant px-3 py-1.5 rounded-md text-sm">詳細</button>
                <button class="action-btn delete-btn border border-outline-variant bg-surface text-red-600 px-3 py-1.5 rounded-md text-sm">削除</button>
            </td>
        </tr>
    `).join('');
}

function updateSortIcons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const icon = btn.querySelector('.material-icons');
        const key = btn.dataset.sortKey;
        if (key === sortState.key) {
            icon.textContent = sortState.direction === 'asc' ? 'arrow_upward' : 'arrow_downward';
        } else {
            icon.textContent = 'unfold_more';
        }
    });
}

function updatePaginationUI() {
    const paginationContainer = document.querySelector('nav[aria-label="ページネーション"] ul');
    if (!paginationContainer) return;
    const totalPages = Math.ceil(filteredOperators.length / rowsPerPage);
    paginationContainer.innerHTML = '';
    if (totalPages <= 1) return;
    
        const createPageLink = (page, text = page, isActive = false, isDisabled = false, isNav = false) => {
    
            const li = document.createElement('li');
    
            if (isNav) {
    
                li.classList.add('flex-shrink-0');
    
            }
    
            const a = document.createElement('a');
    
            a.href = '#';
    
            a.textContent = text;
    
            a.dataset.page = page;
    
            a.className = `flex items-center justify-center px-3 h-8 leading-tight whitespace-nowrap`;
    
            if (isActive) {
    
                a.className += ' text-blue-600 border border-gray-300 bg-blue-50 hover:bg-blue-100 hover:text-blue-700';
    
                a.setAttribute('aria-current', 'page');
    
            } else {
    
                a.className += ' text-gray-500 bg-white border border-gray-300 hover:bg-gray-100 hover:text-gray-700';
    
            }
    
            if (isDisabled) {
    
                a.classList.add('opacity-50', 'cursor-not-allowed');
    
                a.removeAttribute('data-page');
    
            }
    
            li.appendChild(a);
    
            return li;
    
        };
    
        paginationContainer.appendChild(createPageLink(currentPage - 1, '前へ', false, currentPage === 1, true));
    
        for (let i = 1; i <= totalPages; i++) {
    
            paginationContainer.appendChild(createPageLink(i, i, i === currentPage));
    
        }
    
        paginationContainer.appendChild(createPageLink(currentPage + 1, '次へ', false, currentPage === totalPages, true));
}

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.toggle('hidden', !show);
        modal.classList.toggle('flex', show);
    }
}

function initToolboxTabs() {
    const tabs = document.querySelectorAll('.toolbox-tab');
    const tabPanels = document.querySelectorAll('[role="tabpanel"]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            tabPanels.forEach(p => p.classList.add('hidden'));
            document.getElementById(tab.getAttribute('aria-controls')).classList.remove('hidden');
        });
    });
}

function populateFilterRoles() {
    const container = document.getElementById('filter-roles-container');
    if (!container) return;
    container.innerHTML = roles.map(role => `
        <label class="form-check-label">
            <input type="checkbox" class="form-checkbox" name="role" value="${role}"> ${role}
        </label>
    `).join('');
}

function populateFilterGroups() {
    const selectEl = document.getElementById('filter-group');
    if (!selectEl) return;
    const groupOptions = MOCK_GROUPS.map(group => `
        <option value="${group.name}">${group.name}</option>
    `).join('');
    selectEl.innerHTML += groupOptions;
}

function populateFilterLanguages() {
    const selectEl = document.getElementById('filter-language');
    if (!selectEl) return;
    const languageOptions = languages.map(lang => `
        <option value="${lang}">${lang}</option>
    `).join('');
    selectEl.innerHTML += languageOptions;
}

function initInviteOperatorModal() {
    const modalContainer = document.getElementById('invite-operator-modal');
    if (!modalContainer) return;

    const modalHTML = `
        <div class="relative bg-surface rounded-xl shadow-2xl w-full max-w-lg p-6 m-4">
            <button id="close-invite-modal-btn" class="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface"><span class="material-icons">close</span></button>
            <h3 class="text-headline-small font-semibold mb-4">新規オペレーター招待</h3>
            <form id="invite-operator-form">
                <div class="space-y-4">
                    <div class="space-y-1">
                        <label for="assigned-id" class="form-label">割り振られるID</label>
                        <input type="text" id="assigned-id" name="assignedId" class="form-input w-full bg-gray-100 text-gray-500 cursor-not-allowed" readonly>
                    </div>
                    <div class="space-y-1">
                        <label for="affiliation" class="form-label">所属</label>
                        <select id="affiliation" name="affiliation" class="form-select w-full">
                            ${getGroupOptionsHtml()}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label for="role" class="form-label">権限</label>
                        <select id="role" name="role" class="form-select w-full">
                             ${roles.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label for="email" class="form-label">メールアドレス</label>
                        <input type="email" id="email" name="email" class="form-input w-full" required>
                    </div>
                    <div class="space-y-1">
                        <label for="name" class="form-label">オペレーター名</label>
                        <input type="text" id="name" name="name" class="form-input w-full" required>
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-outline-variant">
                    <button type="button" id="cancel-invite-btn" class="border border-outline-variant bg-surface text-on-surface-variant px-3 py-1.5 rounded-md text-sm">キャンセル</button>
                    <button type="submit" class="button-primary text-on-primary py-2 px-4 rounded-md shadow-sm text-sm font-semibold leading-normal transition-colors">招待を送信</button>
                </div>
            </form>
        </div>
    `;
    modalContainer.innerHTML = modalHTML;

    // Add logic to update assigned ID
    const roleSelect = document.getElementById('role');
    const assignedIdInput = document.getElementById('assigned-id');

    const updateAssignedId = () => {
        const selectedRole = roleSelect.value;
        if (selectedRole === 'Abroadスタッフ(Lv3)' || selectedRole === 'Abroadマネージャー(Lv4)') {
            assignedIdInput.value = 'ab-000';
        } else {
            assignedIdInput.value = 'op-000';
        }
    };

    roleSelect?.addEventListener('change', updateAssignedId);
    updateAssignedId(); // Call once to set initial value

    document.getElementById('open-invite-modal-btn')?.addEventListener('click', () => toggleModal('invite-operator-modal', true));
    document.getElementById('close-invite-modal-btn')?.addEventListener('click', () => toggleModal('invite-operator-modal', false));
    document.getElementById('cancel-invite-btn')?.addEventListener('click', () => toggleModal('invite-operator-modal', false));
    
    document.getElementById('invite-operator-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const affiliation = formData.get('affiliation');
        
        let newId;
        if (affiliation === 'Abroad') {
            abCounter++;
            newId = `ab-${String(abCounter).padStart(3, '0')}`;
        } else {
            opCounter++;
            newId = `op-${String(opCounter).padStart(3, '0')}`;
        }

        const newOperator = {
            id: newId,
            name: formData.get('name'),
            email: formData.get('email'),
            affiliation: affiliation,
            role: formData.get('role'),
            group: groups[Math.floor(Math.random() * groups.length)],
            status: 'active',
            registrationDate: new Date().toISOString().split('T')[0],
            lastLoginDate: new Date().toISOString().split('T')[0],
            totalCompleted: 0,
        };

        dummyOperators.unshift(newOperator);

        // Add to history
        dummyHistory.push({
            type: '新規招待',
            actor: '（現在の管理者）', // Replace with actual admin user later
            message: `新規オペレーター「${newOperator.name}」(${newOperator.email}) を招待しました。`,
            timestamp: new Date().toLocaleString('ja-JP'),
            color: 'purple-500'
        });
        renderHistory(dummyHistory);

        applyFiltersAndSearch();
        
        showToast(`新規オペレーター「${newOperator.name}」を招待しました。(ID: ${newOperator.id})`, 'success');
        toggleModal('invite-operator-modal', false);
        e.target.reset();
    });

    // Add listener to close modal on overlay click
    document.getElementById('invite-operator-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'invite-operator-modal') {
            toggleModal('invite-operator-modal', false);
        }
    });
}

function initEditOperatorModal() {
    const modalContainer = document.getElementById('edit-operator-modal');
    if (!modalContainer) return;

    const modalHTML = `
        <div class="relative bg-surface rounded-xl shadow-2xl w-full max-w-2xl p-6 m-4">
            <button id="close-edit-modal-btn" class="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface"><span class="material-icons">close</span></button>
            <h3 class="text-headline-small font-semibold mb-4">オペレーター情報編集</h3>
            <form id="edit-operator-form">
                <input type="hidden" name="id">
                <div class="grid grid-cols-1 gap-6">
                    <div class="space-y-1">
                        <label for="edit-id" class="form-label">オペレーターID</label>
                        <input type="text" id="edit-id" name="displayId" class="form-input w-full bg-gray-100 text-gray-500 cursor-not-allowed" readonly>
                    </div>
                    <div class="space-y-1">
                        <label for="edit-name" class="form-label">オペレーター名</label>
                        <input type="text" id="edit-name" name="name" class="form-input w-full">
                    </div>
                    <div class="space-y-1">
                        <label for="edit-email" class="form-label">メールアドレス</label>
                        <input type="email" id="edit-email" name="email" class="form-input w-full">
                    </div>
                    <div class="space-y-1">
                        <label for="edit-affiliation" class="form-label">所属</label>
                        <select id="edit-affiliation" name="affiliation" class="form-select w-full">
                            ${getGroupOptionsHtml()}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label for="edit-role" class="form-label">権限</label>
                        <select id="edit-role" name="role" class="form-select w-full">
                            ${roles.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label for="edit-status" class="form-label">ステータス</label>
                        <select id="edit-status" name="status" class="form-select w-full">
                            <option value="active">有効</option>
                            <option value="suspended">無効</option>
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label class="form-label">対応可能言語</label>
                        <div id="edit-languages-container" class="grid grid-cols-2 gap-2">
                            <!-- JSでチェックボックスを生成 -->
                        </div>
                    </div>
                </div>

                <div class="mt-6 pt-6 border-t border-outline-variant">
                    <h4 class="text-title-medium font-semibold mb-4">パスワード管理</h4>
                    <div class="flex flex-wrap gap-4 items-center">
                        <button type="button" id="password-change-btn" class="border border-outline-variant bg-surface text-on-surface-variant px-3 py-1.5 rounded-md text-sm">パスワード変更</button>
                        <button type="button" id="password-reset-btn" class="border border-outline-variant bg-surface text-on-surface-variant px-3 py-1.5 rounded-md text-sm">パスワード初期化メール送信</button>
                    </div>
                </div>

                <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-outline-variant">
                    <button type="button" id="cancel-edit-btn" class="border border-outline-variant bg-surface text-on-surface-variant px-3 py-1.5 rounded-md text-sm">キャンセル</button>
                    <button type="submit" class="button-primary text-on-primary py-2 px-4 rounded-md shadow-sm text-sm font-semibold leading-normal transition-colors">変更を保存</button>
                </div>
            </form>
        </div>
    `;
    modalContainer.innerHTML = modalHTML;

    const languagesContainer = document.getElementById('edit-languages-container');
    if (languagesContainer) {
        languagesContainer.innerHTML = languages.map(lang => `
            <label class="form-check-label">
                <input type="checkbox" class="form-checkbox" name="languages" value="${lang}"> ${lang}
            </label>
        `).join('');
    }

    document.getElementById('close-edit-modal-btn')?.addEventListener('click', () => toggleModal('edit-operator-modal', false));
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => toggleModal('edit-operator-modal', false));

    document.getElementById('password-change-btn')?.addEventListener('click', () => {
        showConfirmationModal('新しいパスワードを入力してください。確認のため2回入力してください。', (inputValues) => {
            console.log('[operator-management] onConfirm callback called.');
            console.log('[operator-management] Input values received:', inputValues);
            const newPassword = inputValues.newPassword;
            const confirmNewPassword = inputValues.confirmNewPassword;

            if (!newPassword || !confirmNewPassword) {
                console.log('[operator-management] Validation failed: Passwords not fully entered.');
                showToast('パスワードをすべて入力してください。', 'error');
                return;
            }

            if (newPassword !== confirmNewPassword) {
                console.log('[operator-management] Validation failed: Passwords do not match.');
                showToast('パスワードが一致しません。', 'error');
                return;
            }

            // In a real app, you would send this to the server.
            showToast('パスワードが変更されました。', 'success');
        }, {
            title: 'パスワード変更',
            confirmText: '保存',
            cancelText: 'キャンセル',
            prompt: [
                { type: 'password', label: '新しいパスワード', id: 'newPassword', required: true },
                { type: 'password', label: '新しいパスワード（確認用）', id: 'confirmNewPassword', required: true }
            ]
        });
    });

    document.getElementById('password-reset-btn')?.addEventListener('click', () => {
        showConfirmationModal('パスワードリセットメールを送信します。よろしいですか？', () => {
            showToast('パスワードリセットメールを送信しました。', 'success');
            // In a real app, you would trigger a server-side email action.
        }, {
            title: 'パスワードリセットメール送信の確認',
            confirmText: '送信',
            cancelText: 'キャンセル',
        });
    });

    document.getElementById('edit-operator-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const operatorId = formData.get('id');
        const operatorIndex = dummyOperators.findIndex(op => op.id === operatorId);
        if (operatorIndex === -1) return;

        const originalOperator = { ...dummyOperators[operatorIndex] };

        const selectedLanguages = formData.getAll('languages');
        const updatedFields = {
            name: formData.get('name'),
            email: formData.get('email'),
            affiliation: formData.get('affiliation'),
            role: formData.get('role'),
            status: formData.get('status'),
            languages: selectedLanguages,
        };

        dummyOperators[operatorIndex] = { ...dummyOperators[operatorIndex], ...updatedFields };

        // --- History Logging ---
        const changes = [];
        if (originalOperator.name !== updatedFields.name) changes.push(`氏名を「${updatedFields.name}」に変更`);
        if (originalOperator.email !== updatedFields.email) changes.push(`メールを「${updatedFields.email}」に変更`);
        if (originalOperator.affiliation !== updatedFields.affiliation) changes.push(`所属を「${updatedFields.affiliation}」に変更`);
        if (originalOperator.role !== updatedFields.role) changes.push(`権限を「${updatedFields.role}」に変更`);
        if (originalOperator.status !== updatedFields.status) changes.push(`ステータスを「${updatedFields.status === 'active' ? '有効' : '無効'}」に変更`);
        // Compare sorted arrays to ignore order differences
        if (JSON.stringify((originalOperator.languages || []).sort()) !== JSON.stringify(updatedFields.languages.sort())) {
            changes.push(`対応可能言語を「${updatedFields.languages.join(', ') || 'なし'}」に変更`);
        }

        if (changes.length > 0) {
            dummyHistory.push({
                type: '情報変更',
                actor: '（現在の管理者）',
                message: `オペレーター「${originalOperator.name}」(ID: ${operatorId}) の情報を変更しました：\n- ${changes.join('\n- ')}`,
                timestamp: new Date().toLocaleString('ja-JP'),
                color: 'blue-500'
            });
            renderHistory(dummyHistory);
        }
        
        applyFiltersAndSearch();
        toggleModal('edit-operator-modal', false);
        showToast('オペレーター情報が更新されました。', 'success');
    });

    // Add listener to close modal on overlay click
    document.getElementById('edit-operator-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'edit-operator-modal') {
            toggleModal('edit-operator-modal', false);
        }
    });
}

function openEditModal(operator) {
    const form = document.getElementById('edit-operator-form');
    if (!form) return;

    form.elements.id.value = operator.id;
    document.getElementById('edit-id').value = operator.id; // Populate the display ID field
    form.elements.name.value = operator.name;
    form.elements.email.value = operator.email;
    form.elements.affiliation.value = operator.affiliation;
    form.elements.role.value = operator.role;
    form.elements.status.value = operator.status;

    document.querySelectorAll('#edit-languages-container input[name="languages"]').forEach(checkbox => {
        checkbox.checked = operator.languages && operator.languages.includes(checkbox.value);
    });

    toggleModal('edit-operator-modal', true);
}

function adjustHistoryPanelHeight() {
    const historyPanel = document.getElementById('history-panel-content');
    if (!historyPanel) return;

    const topOffset = historyPanel.getBoundingClientRect().top;
    const viewportHeight = window.innerHeight;
    
    // Calculate available height considering some bottom padding (24px)
    const availableHeight = viewportHeight - topOffset - 24;
    
    // Set a reasonable minimum height
    const minHeight = 150; // 150px

    historyPanel.style.height = `${Math.max(availableHeight, minHeight)}px`;
}

export function initOperatorManagementPage() {
    rowsPerPage = parseInt(document.getElementById('rows-per-page')?.value || '25', 10);
    flatpickr.localize(flatpickr.l10ns.ja);
    flatpickr("#registrationDate-range", { mode: "range", dateFormat: "Y-m-d" });

    // Adjust history panel height on load and resize
    adjustHistoryPanelHeight();
    window.addEventListener('resize', debounce(adjustHistoryPanelHeight, 150));

    const filterForm = document.getElementById('filter-form');

    applyFiltersAndSearch = () => {
        const formData = new FormData(filterForm);
        const searchTerm = formData.get('search-input')?.toLowerCase() || '';
        const roles = formData.getAll('role');
        const statuses = formData.getAll('status');
        const selectedGroup = formData.get('group') || '';
        const selectedLanguage = formData.get('language') || '';
        const [regDateStart, regDateEnd] = (formData.get('registrationDate-range') || '').split(' to ');
        const totalCompletedMin = formData.get('totalCompleted_min');
        const totalCompletedMax = formData.get('totalCompleted_max');

        filteredOperators = dummyOperators.filter(op => {
            const searchMatch = !searchTerm || 
                op.name.toLowerCase().includes(searchTerm) || 
                op.email.toLowerCase().includes(searchTerm) ||
                op.id.toLowerCase().includes(searchTerm);
            const roleMatch = roles.length === 0 || roles.includes(op.role);
            const statusMatch = statuses.length === 0 || statuses.includes(op.status);
            const groupMatch = !selectedGroup || op.affiliation === selectedGroup;
            const languageMatch = !selectedLanguage || (op.languages && op.languages.includes(selectedLanguage));
            const regDateMatch = (!regDateStart || op.registrationDate >= regDateStart) && (!regDateEnd || op.registrationDate <= regDateEnd);
            const totalCompletedMinMatch = totalCompletedMin === '' || op.totalCompleted >= parseInt(totalCompletedMin);
            const totalCompletedMaxMatch = totalCompletedMax === '' || op.totalCompleted <= parseInt(totalCompletedMax);
            
            return searchMatch && roleMatch && statusMatch && groupMatch && languageMatch && regDateMatch && totalCompletedMinMatch && totalCompletedMaxMatch;
        });
        currentPage = 1;
        sortState = { key: null, direction: 'none' };
        displayTablePage();
    };

    displayTablePage();
    renderHistory(dummyHistory);
    
    initToolboxTabs();
    populateFilterRoles();
    populateFilterGroups();
    populateFilterLanguages();
    initInviteOperatorModal();
    initEditOperatorModal();
    initCollapsibleToolbox(); // Keep the sliding panel logic
    adjustPagePaddingForFooter(); // Add padding for footer
    initGroupManagement(); // Initialize the group management modal logic

    // --- Bulk Action and Checkbox Logic ---
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const tableBody = document.getElementById('operator-table-body');

    function updateBulkActionUI() {
        const bulkActionSection = document.getElementById('bulk-action-section');
        if (!bulkActionSection) return;

        const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
        const hasSelection = selectedCheckboxes.length > 0;

        bulkActionSection.classList.toggle('hidden', !hasSelection);

        const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
        const bulkChangeRoleBtn = document.getElementById('bulk-change-role-btn');
        const bulkChangeAffiliationBtn = document.getElementById('bulk-change-affiliation-btn');
        const bulkChangeStatusBtn = document.getElementById('bulk-change-status-btn');

        if (bulkDeleteBtn) bulkDeleteBtn.disabled = !hasSelection;
        if (bulkChangeRoleBtn) bulkChangeRoleBtn.disabled = !hasSelection;
        if (bulkChangeAffiliationBtn) bulkChangeAffiliationBtn.disabled = !hasSelection;
        if (bulkChangeStatusBtn) bulkChangeStatusBtn.disabled = !hasSelection;

        // Update select-all checkbox state
        if (selectAllCheckbox) {
            const totalCheckboxes = document.querySelectorAll('.row-checkbox').length;
            if (totalCheckboxes > 0) {
                selectAllCheckbox.checked = hasSelection && selectedCheckboxes.length === totalCheckboxes;
                selectAllCheckbox.indeterminate = hasSelection && selectedCheckboxes.length < totalCheckboxes;
            }
        }
    }

    selectAllCheckbox?.addEventListener('change', (e) => {
        document.querySelectorAll('.row-checkbox').forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        updateBulkActionUI();
    });

    tableBody?.addEventListener('change', (e) => {
        if (e.target.classList.contains('row-checkbox')) {
            updateBulkActionUI();
        }
    });

    document.getElementById('bulk-delete-btn')?.addEventListener('click', () => {
        const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.dataset.operatorId);
        if (selectedIds.length === 0) return;

        showConfirmationModal(`選択した ${selectedIds.length} 人のオペレーターを削除します。この操作は元に戻せません。よろしいですか？`, () => {
            dummyOperators = dummyOperators.filter(op => !selectedIds.includes(op.id));
            applyFiltersAndSearch();
            showToast(`${selectedIds.length} 人のオペレーターを削除しました。`, 'success');
        }, { title: '一括削除の確認', confirmText: '削除' });
    });

    document.getElementById('bulk-change-role-btn')?.addEventListener('click', () => {
        const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.dataset.operatorId);
        if (selectedIds.length === 0) return;

        const roleOptions = roles.map(r => `<option value="${r}">${r}</option>`).join('');
        showConfirmationModal(`選択した ${selectedIds.length} 人のオペレーターの権限を、以下の選択肢から新しい権限に変更します。変更する権限を選択し、よろしければ「変更を適用」をクリックしてください。`, (newRole) => {
            if (newRole) {
                dummyOperators.forEach(op => {
                    if (selectedIds.includes(op.id)) op.role = newRole;
                });
                applyFiltersAndSearch();
                showToast(`${selectedIds.length} 人の権限を「${newRole}」に変更しました。`, 'success');
            }
        }, { 
            title: '一括権限変更',
            confirmText: '変更を適用',
            prompt: { type: 'select', label: '新しい権限', options: roleOptions }
        });
    });

    document.getElementById('bulk-change-affiliation-btn')?.addEventListener('click', () => {
        const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.dataset.operatorId);
        if (selectedIds.length === 0) return;

        const affiliationOptions = getGroupOptionsHtml();
        showConfirmationModal(`選択した ${selectedIds.length} 人のオペレーターの所属を、以下の選択肢から新しい所属に変更します。変更する所属を選択し、よろしければ「変更を適用」をクリックしてください。`, (newAffiliation) => {
            if (newAffiliation) {
                dummyOperators.forEach(op => {
                    if (selectedIds.includes(op.id)) op.affiliation = newAffiliation;
                });
                applyFiltersAndSearch();
                showToast(`${selectedIds.length} 人の所属を「${newAffiliation}」に変更しました。`, 'success');
            }
        }, { 
            title: '一括所属変更',
            confirmText: '変更を適用',
            prompt: { type: 'select', label: '新しい所属', options: affiliationOptions }
        });
    });

    document.getElementById('bulk-change-status-btn')?.addEventListener('click', () => {
        const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.dataset.operatorId);
        if (selectedIds.length === 0) return;

        const statusOptions = `
            <option value="active">有効</option>
            <option value="suspended">無効</option>
        `;

        showConfirmationModal(`選択した ${selectedIds.length} 人のオペレーターのステータスを変更します。`, (newStatus) => {
            if (newStatus) {
                dummyOperators.forEach(op => {
                    if (selectedIds.includes(op.id)) op.status = newStatus;
                });
                applyFiltersAndSearch();
                const statusLabel = newStatus === 'active' ? '有効' : '無効';
                showToast(`${selectedIds.length} 人のステータスを「${statusLabel}」に変更しました。`, 'success');
            }
        }, {
            title: '一括ステータス変更',
            confirmText: '変更を適用',
            prompt: { type: 'select', label: '新しいステータス', options: statusOptions }
        });
    });



    filterForm?.addEventListener('input', debounce(applyFiltersAndSearch, 300));

    document.getElementById('reset-filter-btn')?.addEventListener('click', () => {
        filterForm.reset();
        flatpickr("#registrationDate-range", {}).clear();
        applyFiltersAndSearch();
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.sortKey;
            let direction = 'asc';
            if (sortState.key === key) {
                if (sortState.direction === 'asc') direction = 'desc';
                else if (sortState.direction === 'desc') direction = 'none';
            }
            sortState = { key: direction === 'none' ? null : key, direction };
            if (direction === 'none') {
                filteredOperators = [...dummyOperators];
                 applyFiltersAndSearch();
            } else {
                filteredOperators.sort((a, b) => {
                    const valA = a[key];
                    const valB = b[key];
                    if (valA === null || valA === undefined) return 1;
                    if (valB === null || valB === undefined) return -1;
                    if (typeof valA === 'string') {
                        return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                    } else if (typeof valA === 'number') {
                        return direction === 'asc' ? valA - valB : valB - valA;
                    }
                    return 0;
                });
            }
            currentPage = 1;
            displayTablePage();
        });
    });

    document.getElementById('rows-per-page')?.addEventListener('change', (e) => {
        rowsPerPage = parseInt(e.target.value, 10);
        currentPage = 1;
        displayTablePage();
    });

    document.querySelector('nav[aria-label="ページネーション"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.target.closest('a');
        if (target && target.dataset.page) {
            currentPage = parseInt(target.dataset.page, 10);
            displayTablePage();
        }
    });

    document.getElementById('operator-table-body')?.addEventListener('click', (e) => {
        const target = e.target.closest('.action-btn');
        if (!target) return;
        const operatorId = target.closest('tr').dataset.operatorId;
        const operatorName = target.closest('tr').children[1].textContent;
        if (target.classList.contains('delete-btn')) {
            const message = `${operatorName}さんの情報を完全に削除します。よろしいですか？`;
            const onConfirm = () => {
                const operatorToDelete = dummyOperators.find(op => op.id === operatorId);
                dummyOperators = dummyOperators.filter(op => op.id !== operatorId);
                
                // Add to history
                if(operatorToDelete){
                    dummyHistory.push({
                        type: '削除',
                        actor: '（現在の管理者）', // Replace with actual admin user later
                        message: `オペレーター「${operatorToDelete.name}」(ID: ${operatorId}) を削除しました。`,
                        timestamp: new Date().toLocaleString('ja-JP'),
                        color: 'red-500'
                    });
                    renderHistory(dummyHistory);
                }

                applyFiltersAndSearch();
                showToast('削除を実行しました', 'success');
            };

            showConfirmationModal(message, onConfirm, {
                title: '削除の確認',
                confirmText: '削除',
                cancelText: 'キャンセル',
            });
        } else if (target.classList.contains('detail-btn')) {
            const operator = dummyOperators.find(op => op.id === operatorId);
            if (operator) {
                openEditModal(operator);
            }
        }
    });
    

}



/**
 * Initializes the collapsible toolbox functionality.
 */
function initCollapsibleToolbox() {
    const toggleBtn = document.getElementById('toolbox-toggle-btn');
    const toolboxAside = document.getElementById('toolbox-aside');
    const mainContent = document.getElementById('main-content');
    const btnIcon = toggleBtn.querySelector('.material-icons');

    if (!toggleBtn || !toolboxAside || !mainContent || !btnIcon) {
        console.error('Toolbox elements not found');
        return;
    }

    // Check initial width to set default state
    const toolboxWidth = toolboxAside.offsetWidth;
    const screenWidth = window.innerWidth;
    // Default to closed if toolbox takes more than 25% of the screen
    let isToolboxOpen = (toolboxWidth <= screenWidth * 0.25);

    const updateToolboxState = () => {
        if (isToolboxOpen) {
            // OPEN STATE
            toolboxAside.classList.remove('translate-x-full');
            toggleBtn.style.right = '34.2rem';
            btnIcon.textContent = 'chevron_left';
        } else {
            // CLOSED STATE
            toolboxAside.classList.add('translate-x-full');
            toggleBtn.style.right = '0';
            btnIcon.textContent = 'chevron_right';
        }
    };

    toggleBtn.addEventListener('click', () => {
        isToolboxOpen = !isToolboxOpen;
        updateToolboxState();
    });

    // Initial setup
    updateToolboxState();
}

/**
 * Adjusts the main content padding to prevent the static footer from overlapping content.
 */
function adjustPagePaddingForFooter() {
    const mainContent = document.querySelector('main');
    const footer = document.getElementById('main-footer');

    if (!mainContent || !footer) {
        return;
    }

    const adjustPadding = () => {
        const footerHeight = footer.offsetHeight;
        mainContent.style.paddingBottom = `${footerHeight}px`;
    };

    // Adjust on initial load, after a short delay to ensure footer is rendered.
    setTimeout(adjustPadding, 200);

    // Adjust on window resize.
    window.addEventListener('resize', debounce(adjustPadding, 150));
}


// --- GROUP MANAGEMENT LOGIC ---



let MOCK_OPERATORS_GROUP = [
    { id: 101, name: '田中 太郎', groupId: 1 },
    { id: 102, name: '鈴木 一郎', groupId: 1 },
    { id: 103, name: '佐藤 花子', groupId: 2 },
    { id: 104, name: '高橋 次郎', groupId: 3 },
    { id: 105, name: '伊藤 三郎', groupId: 1 },
    { id: 106, name: '渡辺 直美', groupId: 4 },
    { id: 107, name: '山本 健太', groupId: null }, // Unassigned
    { id: 108, name: '中村 さくら', groupId: 2 },
    { id: 109, name: '小林 翼', groupId: null }, // Unassigned
    { id: 201, name: '加藤 純一', groupId: 1 },
    { id: 202, name: '吉田 光', groupId: 1 },
    { id: 203, name: '山田 健', groupId: 1 },
    { id: 204, name: '佐々木 恵', groupId: 1 },
    { id: 205, name: '山口 翔太', groupId: 1 },
    { id: 206, name: '松本 優', groupId: 1 },
    { id: 207, name: '井上 碧', groupId: 1 },
    { id: 208, name: '木村 大輝', groupId: 1 },
    { id: 209, name: '林 誠', groupId: 1 },
    { id: 210, name: '斎藤 拓海', groupId: 1 },
    { id: 211, name: '清水 奈々', groupId: 1 },
    { id: 212, name: '森 竜也', groupId: 1 },
    { id: 213, name: '阿部 浩', groupId: 1 },
    { id: 214, name: '池田 亮', groupId: 1 },
    { id: 215, name: '橋本 遥', groupId: 1 },
];

let nextGroupId = 6;

function initGroupManagement() {
    const openModalBtn = document.getElementById('open-group-modal-btn');
    const modal = document.getElementById('group-management-modal');

    if (!openModalBtn || !modal) {
        console.error('Group management modal elements not found');
        return;
    }

    openModalBtn.addEventListener('click', async () => {
        try {
            const modalUrl = new URL('../modals/groupManagementModal.html', import.meta.url);
            const response = await fetch(`${modalUrl}?v=${new Date().getTime()}`);
            if (!response.ok) throw new Error('Failed to load modal content');
            modal.innerHTML = await response.text();

            // Inject styles directly to bypass caching issues
            const styleId = 'group-modal-styles';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.innerHTML = `
                    .tab-nav-container {
                        display: flex;
                        border-bottom: 1px solid var(--color-base-border-divider);
                    }
                    .tab-btn {
                        background: none;
                        border: 1px solid var(--color-base-border-divider);
                        border-bottom: none;
                        padding: 0.75rem 1.25rem;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        gap: 0.5rem;
                        color: var(--color-text-sub);
                        font-weight: 500;
                        border-top-left-radius: 0.5rem;
                        border-top-right-radius: 0.5rem;
                        position: relative;
                        margin-bottom: -1px;
                    }
                    .tab-btn:hover {
                        color: var(--color-text-main);
                        background-color: var(--color-base-background-sub);
                    }
                    .tab-btn.active {
                        background-color: var(--color-base-card);
                        color: var(--color-primary);
                        font-weight: 600;
                        border-bottom-color: var(--color-base-card);
                    }
                `;
                document.head.appendChild(style);
            }

            modal.dataset.state = 'open';
            setupGroupModalEventListeners();
        } catch (error) {
            console.error('Error loading group management modal:', error);
            modal.innerHTML = '<p class="text-red-500">モーダルの読み込みに失敗しました。</p>';
        }
    });
}

function setupGroupModalEventListeners() {
    const modal = document.getElementById('group-management-modal');
    const closeModalBtn = document.getElementById('close-group-modal-btn');
    const createGroupBtn = document.getElementById('create-group-btn');
    const groupSelect = document.getElementById('select-group-to-edit');

    const tabCreate = document.getElementById('tab-create-group');
    const tabEdit = document.getElementById('tab-edit-group');

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.dataset.state = 'closed';
        }
    });
    closeModalBtn.addEventListener('click', () => {
        modal.dataset.state = 'closed';
    });

    tabCreate.addEventListener('click', () => switchGroupTab('create'));
    tabEdit.addEventListener('click', () => switchGroupTab('edit'));

    createGroupBtn.addEventListener('click', createGroup);
    groupSelect.addEventListener('change', (e) => renderSelectedGroupDetails(e.target.value));
}

function switchGroupTab(tabName) {
    const tabCreateBtn = document.getElementById('tab-create-group');
    const tabEditBtn = document.getElementById('tab-edit-group');
    const panelCreate = document.getElementById('panel-create-group');
    const panelEdit = document.getElementById('panel-edit-group');
    const groupEditContainer = document.getElementById('group-edit-container');

    if (tabName === 'create') {
        tabCreateBtn.classList.add('active');
        tabEditBtn.classList.remove('active');
        panelCreate.classList.remove('hidden');
        panelEdit.classList.add('hidden');
    } else {
        tabCreateBtn.classList.remove('active');
        tabEditBtn.classList.add('active');
        panelCreate.classList.add('hidden');
        panelEdit.classList.remove('hidden');
        groupEditContainer.classList.add('hidden');
        populateGroupDropdown();
    }
}

async function populateGroupDropdown() {
    const selectEl = document.getElementById('select-group-to-edit');
    if (!selectEl) return;

    const groups = await new Promise(resolve => setTimeout(() => resolve(MOCK_GROUPS), 100));
    selectEl.innerHTML = '<option value="">編集するグループを選択してください</option>';
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        selectEl.appendChild(option);
    });
}

async function renderSelectedGroupDetails(groupId) {
    const container = document.getElementById('group-edit-container');
    if (!container) return;

    if (!groupId) {
        container.classList.add('hidden');
        return;
    }

    const numericGroupId = parseInt(groupId, 10);
    const operators = await new Promise(resolve => setTimeout(() => resolve(MOCK_OPERATORS_GROUP), 100));
    const groupMembers = operators.filter(op => op.groupId === numericGroupId);
    const unassignedOperators = operators.filter(op => op.groupId === null);

    const membersListEl = container.querySelector('#group-members-list');
    const addMemberSelectEl = container.querySelector('.add-member-select');
    const addMemberBtn = container.querySelector('.add-member-btn');
    const deleteGroupBtn = container.querySelector('.delete-group-btn');

    membersListEl.innerHTML = '';
    if (groupMembers.length > 0) {
        groupMembers.forEach(member => {
            const memberEl = document.createElement('div');
            memberEl.className = 'flex items-center justify-between bg-surface-variant/60 p-2 rounded-md';
            memberEl.innerHTML = `
                <span>${member.name}</span>
                <button class="remove-member-btn" data-member-id="${member.id}" aria-label="${member.name}を削除">
                    <span class="material-icons text-on-surface-variant hover:text-error">delete</span>
                </button>
            `;
            memberEl.querySelector('.remove-member-btn').addEventListener('click', removeMember);
            membersListEl.appendChild(memberEl);
        });
    } else {
        membersListEl.innerHTML = '<p class="text-sm text-on-surface-variant">メンバーがいません。</p>';
    }

    addMemberSelectEl.innerHTML = '<option value="">未所属のオペレーターを選択</option>';
    unassignedOperators.forEach(op => {
        addMemberSelectEl.innerHTML += `<option value="${op.id}">${op.name}</option>`;
    });
    addMemberSelectEl.disabled = unassignedOperators.length === 0;
    addMemberBtn.disabled = unassignedOperators.length === 0;

    addMemberBtn.dataset.groupId = numericGroupId;
    deleteGroupBtn.dataset.groupId = numericGroupId;

    const newAddBtn = addMemberBtn.cloneNode(true);
    addMemberBtn.parentNode.replaceChild(newAddBtn, addMemberBtn);
    newAddBtn.addEventListener('click', addMember);

    const newDeleteBtn = deleteGroupBtn.cloneNode(true);
    deleteGroupBtn.parentNode.replaceChild(newDeleteBtn, deleteGroupBtn);
    newDeleteBtn.addEventListener('click', deleteGroup);

    container.classList.remove('hidden');
}

function createGroup() {
    const groupNameInput = document.getElementById('new-group-name');
    const errorEl = document.getElementById('create-group-error');
    const groupName = groupNameInput.value.trim();

    if (!groupName) {
        errorEl.textContent = 'グループ名を入力してください。';
        errorEl.classList.remove('hidden');
        groupNameInput.classList.add('input-error');
        return;
    }
    if (MOCK_GROUPS.some(g => g.name.toLowerCase() === groupName.toLowerCase())) {
        errorEl.textContent = '同じ名前のグループが既に存在します。';
        errorEl.classList.remove('hidden');
        groupNameInput.classList.add('input-error');
        return;
    }

    errorEl.classList.add('hidden');
    groupNameInput.classList.remove('input-error');

    const newGroup = { id: nextGroupId++, name: groupName };
    MOCK_GROUPS.push(newGroup);

    console.log('Creating group:', newGroup);
    // alert(`グループ「${groupName}」を作成しました。（モックデータ）`);
    groupNameInput.value = '';
    switchGroupTab('edit');
}

function deleteGroup(event) {
    const groupId = parseInt(event.currentTarget.dataset.groupId, 10);
    const group = MOCK_GROUPS.find(g => g.id === groupId);
    if (!group) return;

    // if (confirm(`本当にグループ「${group.name}」を削除しますか？\n所属するメンバーは「未所属」になります。`)) {
        MOCK_GROUPS = MOCK_GROUPS.filter(g => g.id !== groupId);
        MOCK_OPERATORS_GROUP.forEach(op => {
            if (op.groupId === groupId) {
                op.groupId = null;
            }
        });

        console.log('Deleting group:', groupId);
        // alert(`グループ「${group.name}」を削除しました。（モックデータ）`);
        switchGroupTab('edit');
    // }
}

function removeMember(event) {
    const memberId = parseInt(event.currentTarget.dataset.memberId, 10);
    const operator = MOCK_OPERATORS_GROUP.find(op => op.id === memberId);
    if (!operator) return;

    // if (confirm(`${operator.name}をグループから削除しますか？`)) {
        operator.groupId = null;
        console.log('Removing member:', memberId);
        // alert(`${operator.name}をグループから削除しました。（モックデータ）`);
        renderSelectedGroupDetails(document.getElementById('select-group-to-edit').value);
    // }
}

function addMember(event) {
    const groupId = parseInt(event.currentTarget.dataset.groupId, 10);
    const selectEl = event.currentTarget.previousElementSibling;
    const memberId = parseInt(selectEl.value, 10);

    if (!memberId) {
        // alert('追加するオペレーターを選択してください。');
        return;
    }

    const operator = MOCK_OPERATORS_GROUP.find(op => op.id === memberId);
    if (operator) {
        operator.groupId = groupId;
        console.log(`Adding member ${memberId} to group ${groupId}`);
        // alert(`${operator.name}をグループに追加しました。（モックデータ）`);
        renderSelectedGroupDetails(document.getElementById('select-group-to-edit').value);
    }
}
