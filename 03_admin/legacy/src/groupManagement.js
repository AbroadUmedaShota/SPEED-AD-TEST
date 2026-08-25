// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/operator-management.html の inline script(グループ作成 #mOpGroup)。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

// Mock data - replace with actual API calls
let MOCK_GROUPS = [
    { id: 1, name: '東京営業部' },
    { id: 2, name: '大阪支社' },
    { id: 3, name: '開発チーム' },
    { id: 4, name: 'マーケティング部' },
    { id: 5, name: 'サポート' },
];

let MOCK_OPERATORS = [
    { id: 101, name: '田中 太郎', groupId: 1 },
    { id: 102, name: '鈴木 一郎', groupId: 1 },
    { id: 103, name: '佐藤 花子', groupId: 2 },
    { id: 104, name: '高橋 次郎', groupId: 3 },
    { id: 105, name: '伊藤 三郎', groupId: 1 },
    { id: 106, name: '渡辺 直美', groupId: 4 },
    { id: 107, name: '山本 健太', groupId: null }, // Unassigned
    { id: 108, name: '中村 さくら', groupId: 2 },
    { id: 109, name: '小林 翼', groupId: null }, // Unassigned
];

let nextGroupId = 6;

// --- Main Initialization ---
export async function initGroupManagement() {
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
            modal.dataset.state = 'open';
            setupModalEventListeners();
            renderEditGroupTab(); // Initial render
        } catch (error) {
            console.error('Error loading group management modal:', error);
            modal.innerHTML = '<p class="text-red-500">モーダルの読み込みに失敗しました。</p>';
        }
    });
}

// --- Event Listener Setup ---
function setupModalEventListeners() {
    const modal = document.getElementById('group-management-modal');
    const closeModalBtn = document.getElementById('close-group-modal-btn');
    const createGroupBtn = document.getElementById('create-group-btn');
    const searchInput = document.getElementById('search-group-input');

    // Tab buttons
    const tabCreate = document.getElementById('tab-create-group');
    const tabEdit = document.getElementById('tab-edit-group');

    // Close modal
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.dataset.state = 'closed';
        }
    });
    closeModalBtn.addEventListener('click', () => {
        modal.dataset.state = 'closed';
    });

    // Tab switching
    tabCreate.addEventListener('click', () => switchTab('create'));
    tabEdit.addEventListener('click', () => switchTab('edit'));

    // Actions
    createGroupBtn.addEventListener('click', createGroup);
    searchInput.addEventListener('input', (e) => renderEditGroupTab(e.target.value));
}

// --- Tab Logic ---
function switchTab(tabName) {
    const tabCreateBtn = document.getElementById('tab-create-group');
    const tabEditBtn = document.getElementById('tab-edit-group');
    const panelCreate = document.getElementById('panel-create-group');
    const panelEdit = document.getElementById('panel-edit-group');

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
        renderEditGroupTab(); // Re-render when switching to edit tab
    }
}

// --- Rendering Logic ---
async function renderEditGroupTab(searchTerm = '') {
    const container = document.getElementById('group-list-container');
    if (!container) return;

    // Simulate API call
    const groups = await new Promise(resolve => setTimeout(() => resolve(MOCK_GROUPS), 100));
    const operators = await new Promise(resolve => setTimeout(() => resolve(MOCK_OPERATORS), 100));

    const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (filteredGroups.length === 0) {
        container.innerHTML = '<p class="text-center text-on-surface-variant">グループが見つかりません。</p>';
        return;
    }

    container.innerHTML = ''; // Clear previous content

    const unassignedOperators = operators.filter(op => op.groupId === null);

    filteredGroups.forEach(group => {
        const groupMembers = operators.filter(op => op.groupId === group.id);
        const accordion = document.createElement('div');
        accordion.className = 'group-accordion border border-outline-variant rounded-lg';
        accordion.innerHTML = `
            <button class=\"accordion-header flex items-center justify-between w-full p-4 text-left\">
                <span class=\"font-semibold text-on-surface">${group.name} (${groupMembers.length}人)</span>
                <div class=\"flex items-center gap-2\">
                    <span class=\"material-icons accordion-icon transition-transform\">expand_more</span>
                </div>
            </button>
            <div class=\"accordion-content hidden p-4 border-t border-outline-variant\">
                <h4 class=\"text-title-small font-medium text-on-surface-variant mb-3\">所属メンバー</h4>
                <div class=\"member-list space-y-2 mb-4\">
                    ${groupMembers.length > 0 ? groupMembers.map(m => `
                        <div class=\"flex items-center justify-between bg-surface-variant/60 p-2 rounded-md\">
                            <span>${m.name}</span>
                            <button class=\"remove-member-btn\" data-member-id=\"${m.id}\" data-group-id=\"${group.id}\" aria-label=\"${m.name}を削除\">
                                <span class=\"material-icons text-on-surface-variant hover:text-error\">delete</span>
                            </button>
                        </div>
                    `).join('') : '<p class="text-sm text-on-surface-variant">メンバーがいません。</p>'}
                </div>
                <h4 class=\"text-title-small font-medium text-on-surface-variant mb-3\">メンバーを追加</h4>
                <div class=\"add-member-controls flex gap-2\">
                    <select class=\"add-member-select form-select flex-grow\" ${unassignedOperators.length === 0 ? 'disabled' : ''}>
                        <option value=\"\">未所属のオペレーターを選択</option>
                        ${unassignedOperators.map(op => `<option value=\" ${op.id}\">${op.name}</option>`).join('')}
                    </select>
                    <button class=\"add-member-btn button-secondary\" data-group-id=\"${group.id}\" ${unassignedOperators.length === 0 ? 'disabled' : ''}>追加</button>
                </div>
                 <div class=\"mt-6 flex justify-end\">
                    <button class=\"delete-group-btn button-danger\" data-group-id=\"${group.id}\">
                        <span class=\"material-icons\">delete_forever</span>
                        <span>グループを削除</span>
                    </button>
                </div>
            </div>
        `;

        container.appendChild(accordion);
    });

    // Add event listeners for the newly rendered elements
    container.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            header.nextElementSibling.classList.toggle('hidden');
            header.querySelector('.accordion-icon').classList.toggle('rotate-180');
        });
    });

    container.querySelectorAll('.remove-member-btn').forEach(btn => btn.addEventListener('click', removeMember));
    container.querySelectorAll('.add-member-btn').forEach(btn => btn.addEventListener('click', addMember));
    container.querySelectorAll('.delete-group-btn').forEach(btn => btn.addEventListener('click', deleteGroup));
}

// --- CRUD Operations ---

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
    // TODO: Implement API call to create group
    alert(`グループ「${groupName}」を作成しました。（モックデータ）`);
    groupNameInput.value = '';
    switchTab('edit'); // Switch to edit tab to show the new group
}

function deleteGroup(event) {
    const groupId = parseInt(event.currentTarget.dataset.groupId, 10);
    const group = MOCK_GROUPS.find(g => g.id === groupId);
    if (!group) return;

    if (confirm(`本当にグループ「${group.name}」を削除しますか？\n所属するメンバーは「未所属」になります。`)) {
        // Remove group
        MOCK_GROUPS = MOCK_GROUPS.filter(g => g.id !== groupId);
        // Unassign members
        MOCK_OPERATORS.forEach(op => {
            if (op.groupId === groupId) {
                op.groupId = null;
            }
        });

        console.log('Deleting group:', groupId);
        // TODO: Implement API call to delete group
        alert(`グループ「${group.name}」を削除しました。（モックデータ）`);
        renderEditGroupTab();
    }
}

function removeMember(event) {
    const memberId = parseInt(event.currentTarget.dataset.memberId, 10);
    const operator = MOCK_OPERATORS.find(op => op.id === memberId);
    if (!operator) return;

    if (confirm(`${operator.name}をグループから削除しますか？`)) {
        operator.groupId = null; // Set as unassigned

        console.log('Removing member:', memberId);
        // TODO: Implement API call
        alert(`${operator.name}をグループから削除しました。（モックデータ）`);
        renderEditGroupTab(document.getElementById('search-group-input').value);
    }
}

function addMember(event) {
    const groupId = parseInt(event.currentTarget.dataset.groupId, 10);
    const selectEl = event.currentTarget.previousElementSibling;
    const memberId = parseInt(selectEl.value, 10);

    if (!memberId) {
        alert('追加するオペレーターを選択してください。');
        return;
    }

    const operator = MOCK_OPERATORS.find(op => op.id === memberId);
    if (operator) {
        operator.groupId = groupId;
        console.log(`Adding member ${memberId} to group ${groupId}`);
        // TODO: Implement API call
        alert(`${operator.name}をグループに追加しました。（モックデータ）`);
        renderEditGroupTab(document.getElementById('search-group-input').value);
    }
}