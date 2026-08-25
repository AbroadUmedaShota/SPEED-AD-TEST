// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/performance-management.html の inline script。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

import { debounce } from '../../02_dashboard/src/utils.js';

// Google-like color palette for avatars
const AVATAR_COLORS = [
    { bg: '#4285F4', text: '#FFFFFF' }, // Blue
    { bg: '#EA4335', text: '#FFFFFF' }, // Red
    { bg: '#FBBC05', text: '#FFFFFF' }, // Yellow
    { bg: '#34A853', text: '#FFFFFF' }, // Green
    { bg: '#673AB7', text: '#FFFFFF' }, // Purple
    { bg: '#00ACC1', text: '#FFFFFF' }, // Cyan
    { bg: '#FF6D00', text: '#FFFFFF' }, // Orange
    { bg: '#F06292', text: '#FFFFFF' }, // Pink
];

const CONFIG = {
    CHART_PADDING: 10,
    THRESHOLD_ACCURACY: 98,
    ITEMS_PER_PAGE_DEFAULT: 25,
    CSV_FILENAME_PREFIX: 'speedad_performance'
};

let performanceData = null;
let currentTab = 'individual';
let currentPage = 1;
let itemsPerPage = CONFIG.ITEMS_PER_PAGE_DEFAULT;
let currentSort = { column: null, direction: 'asc' };

let opComboChart = null;
let opRadarChart = null;
let groupScatterChart = null;
let groupTrendChart = null;

/**
 * Initialization function called from admin.js
 */
export async function initPerformanceManagementPage() {
    exposeGlobals(); 
    renderBreadcrumb();
    initDatePicker();
    
    showLoadingState();
    await loadPerformanceData();
    // No explicit hideLoadingState needed as render functions overwrite the content,
    // but good practice to have logic ready if needed.

    renderSummary();
    renderTables();
    initEventListeners();
}

/**
 * Expose internal functions to window for HTML onclick attributes
 */
function exposeGlobals() {
    window.showOperatorDetail = showOperatorDetail;
    window.closeOperatorDetailModal = closeOperatorDetailModal;
    window.showGroupDetail = showGroupDetail;
    window.closeGroupDetailModal = closeGroupDetailModal;
    window.showParameterModal = showParameterModal;
    window.closeParameterModal = closeParameterModal;
    window.saveParameters = saveParameters;
    window.downloadOperatorCSV = downloadOperatorCSV;
    window.downloadGroupCSV = downloadGroupCSV;
    window.changePage = changePage;
    window.sortTable = sortTable;
    window.resetFilters = resetFilters;
}

/**
 * Helper: HTML Escape for XSS prevention
 */
function escapeHtml(unsafe) {
    if (unsafe == null) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Breadcrumb Rendering
 */
function renderBreadcrumb() {
    const container = document.getElementById('breadcrumb-container');
    if (!container) return;
    
    container.innerHTML = `
        <nav aria-label="Breadcrumb">
            <ol class="flex items-center space-x-1 text-xs text-on-surface-variant">
                <li><a href="index.html" class="hover:text-primary hover:underline">ホーム</a></li>
                <li><span class="material-icons text-[14px]">chevron_right</span></li>
                <li><span class="font-bold text-on-surface">オペレーター実績確認</span></li>
            </ol>
        </nav>
    `;
}

/**
 * Loading State
 */
function showLoadingState() {
    const summaryContainer = document.getElementById('summary-container');
    const tableBody = document.getElementById('performance-table-body');
    
    if (summaryContainer) {
        summaryContainer.innerHTML = `
             <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                ${[...Array(4)].map(() => `<div class="animate-pulse bg-surface-variant/30 h-24 rounded-xl border border-outline-variant"></div>`).join('')}
             </div>
        `;
    }
    
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="py-12 text-center text-on-surface-variant">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-icons animate-spin text-4xl text-primary">autorenew</span>
                        <span class="text-sm">データを読み込み中...</span>
                    </div>
                </td>
            </tr>
        `;
    }
}

/**
 * Filter Reset
 */
function resetFilters() {
    const inputs = [
        'filter-keyword-ind', 'filter-activity-ind', 'filter-exhibition-ind', 'filter-group-ind', 'filter-status-ind', 'filter-quality-ind',
        'filter-keyword-grp', 'filter-status-grp', 'filter-scale-grp', 'filter-cost-grp', 'filter-ontime-grp'
    ];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
    });

    // Reset date pickers to current month
    initDatePicker();

    currentPage = 1;
    renderTables();
    renderSummary();
}

/**
 * Avatar Styling
 */
function getAvatarStyle(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_COLORS.length;
    const color = AVATAR_COLORS[index];
    return `background-color: ${color.bg}; color: ${color.text};`;
}

/**
 * Date Picker Initialization
 */
function initDatePicker() {
    if (window.flatpickr) {
        // Dynamic date range: 1st of current month to last day of current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const formatDate = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        const defaultDate = [formatDate(firstDay), formatDate(lastDay)];

        const config = {
            mode: "range",
            dateFormat: "Y/m/d",
            defaultDate: defaultDate,
            locale: "ja",
            onChange: function() {
                currentPage = 1;
                renderTables();
                renderSummary();
            }
        };
        
        const indPicker = document.getElementById("date-range-filter-ind");
        const grpPicker = document.getElementById("date-range-filter-grp");
        
        if (indPicker) window.flatpickr(indPicker, config);
        if (grpPicker) window.flatpickr(grpPicker, config);
    }
}

/**
 * Data Loading
 */
async function loadPerformanceData() {
    try {
        // Simulate network delay for loading demonstration
        // await new Promise(resolve => setTimeout(resolve, 500)); 
        const response = await fetch('../data/admin/performance.json');
        performanceData = await response.json();
    } catch (error) {
        console.error('Error loading performance data:', error);
        const tableBody = document.getElementById('performance-table-body');
        if (tableBody) {
             tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="py-12 text-center text-error">
                        <div class="flex flex-col items-center gap-2">
                            <span class="material-icons text-4xl">error_outline</span>
                            <span class="text-sm">データの読み込みに失敗しました。</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Summary Rendering
 */
function renderSummary() {
    if (!performanceData) return;
    const summaryContainer = document.getElementById('summary-container');
    if (!summaryContainer) return;

    const filteredData = getFilteredData();

    // 1. Calculate Total Payment
    let currentTotalPayment = 0;
    if (currentTab === 'individual') {
        currentTotalPayment = filteredData.reduce((sum, op) => sum + (op.estPayment || 0), 0);
    } else {
        // For groups, calculate based on operators within the filtered groups
        currentTotalPayment = filteredData.reduce((sum, grp) => {
             let grpPayment = 0;
             if (grp.operators) {
                 grp.operators.forEach(gOp => {
                     const fullOp = performanceData.operators.find(o => o.name === gOp.name);
                     if (fullOp) grpPayment += fullOp.estPayment;
                 });
             }
             return sum + grpPayment;
        }, 0);
    }
    const estimatedLanding = Math.round(currentTotalPayment * 1.2);

    // 2. Calculate Active Users / Total Users
    let activeUsers = 0;
    let totalUsers = 0;
    if (currentTab === 'individual') {
        totalUsers = filteredData.length;
        activeUsers = filteredData.filter(op => op.processed > 0).length;
    } else {
        totalUsers = filteredData.reduce((sum, grp) => sum + (grp.totalUsers || 0), 0);
        activeUsers = filteredData.reduce((sum, grp) => sum + (grp.activeUsers || 0), 0);
    }

    // 3. Calculate Average Error Rate
    let totalProcessed = 0;
    let totalErrors = 0;
    if (currentTab === 'individual') {
        filteredData.forEach(op => {
            totalProcessed += op.processed;
            totalErrors += op.errors;
        });
    } else {
         filteredData.forEach(grp => {
             if (grp.operators) {
                 grp.operators.forEach(gOp => {
                     const fullOp = performanceData.operators.find(o => o.name === gOp.name);
                     if (fullOp) {
                         totalProcessed += fullOp.processed;
                         totalErrors += fullOp.errors;
                     }
                 });
             }
         });
    }
    const avgErrorRate = totalProcessed > 0 ? ((totalErrors / totalProcessed) * 100).toFixed(2) : "0.00";

    // 4. Calculate Max Capacity
    let totalCapacity = 0;
    if (currentTab === 'individual') {
        // Estimate: (8 hours in seconds / avgTime) for each operator
        const SECONDS_IN_DAY = 8 * 3600; 
        filteredData.forEach(op => {
             if (op.avgTime > 0) {
                 totalCapacity += Math.floor(SECONDS_IN_DAY / op.avgTime);
             }
        });
    } else {
        totalCapacity = filteredData.reduce((sum, grp) => sum + (grp.maxCapacity || 0), 0);
    }

    // Last month comparison (Fixed value from JSON as historical data comparison logic is complex)
    const lastMonthComparison = performanceData.summary.lastMonthComparison;

    summaryContainer.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="bg-surface p-4 rounded-xl border border-outline-variant shadow-sm text-center lg:text-left">
                <div class="text-sm text-on-surface-variant mb-1">期間内の支払い確定額</div>
                <div class="flex items-baseline justify-center lg:justify-start gap-2">
                    <span class="text-2xl font-bold text-primary">¥${currentTotalPayment.toLocaleString()}</span>
                    <span class="text-xs ${lastMonthComparison >= 0 ? 'text-success' : 'text-error'} font-medium" title="前月比 (固定値)">
                        ${lastMonthComparison >= 0 ? '↑' : '↓'} ${Math.abs(lastMonthComparison)}%
                    </span>
                </div>
                <div class="text-[10px] text-on-surface-variant mt-1">着地見込: ¥${estimatedLanding.toLocaleString()}</div>
            </div>
            <div class="bg-surface p-4 rounded-xl border border-outline-variant shadow-sm text-center lg:text-left">
                <div class="text-sm text-on-surface-variant mb-1">稼働人数 / 表示対象</div>
                <div class="text-2xl font-bold">${activeUsers.toLocaleString()} / ${totalUsers.toLocaleString()} <span class="text-sm font-normal text-on-surface-variant ml-1">人</span></div>
                <div class="w-full bg-outline-variant h-1.5 rounded-full mt-2 overflow-hidden">
                    <div class="bg-primary h-full transition-all duration-500" style="width: ${totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0}%"></div>
                </div>
            </div>
            <div class="bg-surface p-4 rounded-xl border border-outline-variant shadow-sm text-center lg:text-left">
                <div class="text-sm text-on-surface-variant mb-1">期間内の平均エラー率</div>
                <div class="text-2xl font-bold ${parseFloat(avgErrorRate) > performanceData.parameters.targetErrorRate ? 'text-error' : 'text-success'}">
                    ${avgErrorRate}% <span class="text-sm font-normal text-on-surface-variant ml-1 text-on-surface">Avg Error</span>
                </div>
                <div class="text-xs text-on-surface-variant mt-1">目標: ${performanceData.parameters.targetErrorRate}%以下</div>
            </div>
            <div class="bg-surface p-4 rounded-xl border border-outline-variant shadow-sm text-center lg:text-left">
                <div class="text-sm text-on-surface-variant mb-1">推定最大処理能力</div>
                <div class="text-2xl font-bold">${totalCapacity.toLocaleString()} <span class="text-sm font-normal text-on-surface-variant ml-1 text-on-surface">枚/日</span></div>
                <div class="text-xs text-on-surface-variant mt-1">表示メンバーの合計値(8h換算)</div>
            </div>
        </div>
    `;
}

/**
 * Table Rendering
 */
function renderTables() {
    if (currentTab === 'individual') {
        renderIndividualTable();
    } else {
        renderGroupTable();
    }
}

function sortTable(column) {
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'desc';
    }
    renderTables();
}

function getSortIcon(column) {
    if (currentSort.column !== column) return '<span class="material-icons text-[10px] text-on-surface-variant/30 ml-1">unfold_more</span>';
    return currentSort.direction === 'asc' 
        ? '<span class="material-icons text-[10px] text-primary ml-1">expand_less</span>' 
        : '<span class="material-icons text-[10px] text-primary ml-1">expand_more</span>';
}

function createSortableHeader(label, column, align = 'center') {
    return `
        <th class="px-4 py-3 text-${align} cursor-pointer hover:bg-surface-variant/50 transition-colors select-none group" onclick="window.sortTable('${column}')">
            <div class="flex items-center justify-${align === 'left' ? 'start' : (align === 'right' ? 'end' : 'center')} gap-1">
                ${escapeHtml(label)}
                ${getSortIcon(column)}
            </div>
        </th>
    `;
}

function renderIndividualTable() {
    const tableBody = document.getElementById('performance-table-body');
    const tableHeader = document.getElementById('performance-table-header');
    if (!tableBody || !tableHeader) return;

    tableHeader.innerHTML = `
        <tr>
            ${createSortableHeader('オペレーター/所属', 'name', 'left')}
            ${createSortableHeader('入力完了数', 'processed', 'center')}
            ${createSortableHeader('エラー件数', 'errors', 'center')}
            ${createSortableHeader('有効作業数', 'valid', 'center')}
            ${createSortableHeader('作業時間 / 平均', 'avgTime', 'center')}
            ${createSortableHeader('推定報酬額', 'estPayment', 'center')}
            ${createSortableHeader('正確さ', 'accuracy', 'center')}
            ${createSortableHeader('達成状況', 'status', 'center')}
            <th class="px-4 py-3 text-right">詳細</th>
        </tr>
    `;

    let filteredData = getFilteredData();
    // Add accuracy property for sorting
    filteredData.forEach(op => {
        op.accuracy = op.processed > 0 ? parseFloat((100 - (op.errors / op.processed * 100)).toFixed(1)) : 0;
    });

    if (currentSort.column) {
        filteredData.sort((a, b) => {
            let valA = a[currentSort.column];
            let valB = b[currentSort.column];
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const totalItems = filteredData.length;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const displayData = filteredData.slice(startIndex, endIndex);

    tableBody.innerHTML = displayData.map(op => `
        <tr class="group hover:bg-primary/5 cursor-pointer transition-colors ${op.processed === 0 ? 'opacity-50' : ''}" onclick="window.showOperatorDetail('${escapeHtml(op.id)}')">
            <td class="px-4 py-4 text-left">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shadow-sm transition-transform group-hover:scale-110" style="${getAvatarStyle(op.name)}">
                        ${escapeHtml(op.name.charAt(0))}
                    </div>
                    <div>
                        <div class="font-bold text-on-surface group-hover:text-primary transition-colors">${escapeHtml(op.name)}</div>
                        <div class="text-[11px] text-on-surface-variant flex items-center gap-1">
                            <span class="material-icons text-[12px]">badge</span> ${escapeHtml(op.id)}
                            <span class="mx-1">/</span>
                            <span class="material-icons text-[12px]">group</span> ${escapeHtml(op.group)}
                        </div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-4 text-center">${Number(op.processed).toLocaleString()}</td>
            <td class="px-4 py-4 text-center text-error">${Number(op.errors).toLocaleString()}</td>
            <td class="px-4 py-4 text-center font-bold text-primary">${Number(op.valid).toLocaleString()}</td>
            <td class="px-4 py-4 text-center">
                <div class="text-sm font-medium text-on-surface">${escapeHtml(op.workTime)}</div>
                <div class="text-[10px] text-on-surface-variant uppercase">Avg: ${escapeHtml(op.avgTime)}s</div>
            </td>
            <td class="px-4 py-4 text-center font-bold text-on-surface">¥${Number(op.estPayment).toLocaleString()}</td>
            <td class="px-4 py-4 text-center font-bold ${op.accuracy < 95 ? 'text-error' : (op.accuracy >= 99 ? 'text-success' : 'text-on-surface')}">${op.accuracy}%</td>
            <td class="px-4 py-4 text-center">
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${op.status === '達成' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}">
                    <span class="material-icons text-[12px]">${op.status === '達成' ? 'check_circle' : 'warning'}</span>
                    ${escapeHtml(op.status)}
                </span>
            </td>
            <td class="px-4 py-4 text-right">
                <span class="material-icons text-on-surface-variant group-hover:text-primary transition-colors">chevron_right</span>
            </td>
        </tr>
    `).join('');

    renderPagination(totalItems, startIndex, endIndex);
}

function renderGroupTable() {
    const tableBody = document.getElementById('performance-table-body');
    const tableHeader = document.getElementById('performance-table-header');
    if (!tableBody || !tableHeader) return;

    tableHeader.innerHTML = `
        <tr>
            ${createSortableHeader('グループ名', 'name', 'left')}
            ${createSortableHeader('稼働 / 登録人数', 'activeUsers', 'center')}
            ${createSortableHeader('最大処理能力', 'maxCapacity', 'center')}
            ${createSortableHeader('品質レベル (Avg Time / 偏差)', 'avgTime', 'center')}
            ${createSortableHeader('コスパ (CPY)', 'costPerformance', 'center')}
            ${createSortableHeader('納期遵守率', 'onTimeRate', 'center')}
            <th class="px-4 py-3 text-right">詳細</th>
        </tr>
    `;

    let filteredData = getFilteredData();
    if (currentSort.column) {
        filteredData.sort((a, b) => {
            let valA = a[currentSort.column];
            let valB = b[currentSort.column];
            if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const totalItems = filteredData.length;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const displayData = filteredData.slice(startIndex, endIndex);

    tableBody.innerHTML = displayData.map(group => `
        <tr class="hover:bg-primary/5 cursor-pointer transition-colors" onclick="window.showGroupDetail('${escapeHtml(group.id)}')">
            <td class="px-4 py-4 font-bold text-on-surface text-left">${escapeHtml(group.name)}</td>
            <td class="px-4 py-4 text-center">
                <div class="flex flex-col">
                    <span class="font-bold text-on-surface">${Number(group.activeUsers).toLocaleString()} <span class="font-normal text-[10px] text-on-surface-variant">/ ${Number(group.totalUsers).toLocaleString()}人</span></span>
                    <div class="w-12 h-1 bg-outline-variant rounded-full mx-auto mt-1">
                        <div class="bg-primary h-full rounded-full" style="width: ${(group.activeUsers/group.totalUsers)*100}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-4 py-4 text-center">
                <span class="font-medium text-on-surface">${Number(group.maxCapacity).toLocaleString()}</span>
                <span class="text-[10px] text-on-surface-variant block uppercase">枚/日</span>
            </td>
            <td class="px-4 py-4 text-center">
                <div class="text-sm font-medium text-on-surface">${escapeHtml(group.avgTime)}s <span class="font-normal text-[10px] text-on-surface-variant">/ 枚</span></div>
                <div class="text-[10px] text-on-surface-variant">ばらつき: ${escapeHtml(group.qualityVariance)}</div>
            </td>
            <td class="px-4 py-4 text-center font-bold text-primary">${escapeHtml(group.costPerformance)} <span class="text-[10px] text-on-surface-variant font-normal">枚/円</span></td>
            <td class="px-4 py-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <div class="w-16 bg-outline-variant h-1.5 rounded-full overflow-hidden">
                        <div class="bg-success h-full" style="width: ${group.onTimeRate}%"></div>
                    </div>
                    <span class="text-xs font-bold text-on-surface">${escapeHtml(group.onTimeRate)}%</span>
                </div>
            </td>
            <td class="px-4 py-4 text-right">
                <span class="material-icons text-on-surface-variant group-hover:text-primary transition-colors">chevron_right</span>
            </td>
        </tr>
    `).join('');

    renderPagination(totalItems, startIndex, endIndex);
}

function renderPagination(totalItems, startIndex, endIndex) {
    const paginationControls = document.getElementById('pagination-controls');
    const paginationInfo = document.getElementById('pagination-info');
    if (!paginationControls || !paginationInfo) return;

    paginationInfo.textContent = `全 ${totalItems} 件中 ${totalItems > 0 ? startIndex + 1 : 0}-${endIndex} 件を表示`;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    let controlsHtml = '';

    controlsHtml += `<button class="p-1 rounded hover:bg-surface-variant disabled:opacity-30" onclick="window.changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><span class="material-icons text-base">chevron_left</span></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            controlsHtml += `<button class="px-2.5 py-1 rounded bg-primary text-on-primary text-xs font-bold pointer-events-none">${i}</button>`;
        } else {
            if (totalPages <= 7 || i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                 controlsHtml += `<button class="px-2.5 py-1 rounded hover:bg-surface-variant text-xs font-medium text-on-surface-variant" onclick="window.changePage(${i})">${i}</button>`;
            } else if (i === currentPage - 2 || i === currentPage + 2) {
                controlsHtml += `<span class="px-1 text-xs text-on-surface-variant">...</span>`;
            }
        }
    }
    controlsHtml += `<button class="p-1 rounded hover:bg-surface-variant disabled:opacity-30" onclick="window.changePage(${currentPage + 1})" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}><span class="material-icons text-base">chevron_right</span></button>`;
    paginationControls.innerHTML = controlsHtml;
}

function changePage(page) {
    const totalItems = getFilteredData().length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderTables();
        const tableContainer = document.querySelector('.bg-surface.rounded-b-xl');
        if (tableContainer) {
            const yOffset = -100;
            const y = tableContainer.getBoundingClientRect().top + window.pageYOffset + yOffset;
            window.scrollTo({top: y, behavior: 'smooth'});
        }
    }
}

function initEventListeners() {
    const tabIndividual = document.getElementById('tab-individual');
    const tabGroup = document.getElementById('tab-group');

    if (tabIndividual && tabGroup) {
        tabIndividual.addEventListener('click', () => {
            currentTab = 'individual';
            currentPage = 1;
            tabIndividual.classList.add('border-primary', 'text-primary');
            tabIndividual.classList.remove('border-transparent', 'text-on-surface-variant');
            tabGroup.classList.remove('border-primary', 'text-primary');
            tabGroup.classList.add('border-transparent', 'text-on-surface-variant');
            document.getElementById('filters-individual').classList.remove('hidden');
            document.getElementById('filters-group').classList.add('hidden');
            renderTables();
            renderSummary();
        });

        tabGroup.addEventListener('click', () => {
            currentTab = 'group';
            currentPage = 1;
            tabGroup.classList.add('border-primary', 'text-primary');
            tabGroup.classList.remove('border-transparent', 'text-on-surface-variant');
            tabIndividual.classList.remove('border-primary', 'text-primary');
            tabIndividual.classList.add('border-transparent', 'text-on-surface-variant');
            document.getElementById('filters-individual').classList.add('hidden');
            document.getElementById('filters-group').classList.remove('hidden');
            renderTables();
            renderSummary();
        });
    }

    const parameterBtn = document.getElementById('parameter-settings-btn');
    if (parameterBtn) parameterBtn.addEventListener('click', () => window.showParameterModal());

    const csvBtn = document.getElementById('csv-export-btn');
    if (csvBtn) csvBtn.addEventListener('click', () => exportCSV(getFilteredData()));
    
    const itemsPerPageSelect = document.getElementById('items-per-page');
    if (itemsPerPageSelect) {
        itemsPerPageSelect.addEventListener('change', (e) => {
            itemsPerPage = parseInt(e.target.value);
            currentPage = 1;
            renderTables();
        });
    }

    const filterInputs = [
        'date-range-filter-ind', 'filter-exhibition-ind', 'filter-group-ind', 'filter-status-ind', 'filter-activity-ind', 'filter-keyword-ind',
        'date-range-filter-grp', 'filter-status-grp', 'filter-scale-grp', 'filter-cost-grp', 'filter-keyword-grp'
    ];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
                currentPage = 1;
                renderTables();
                renderSummary();
            });
        }
    });

    const modals = ['parameter-modal', 'operator-detail-modal', 'group-detail-modal'];
    modals.forEach(id => {
        const modal = document.getElementById(id);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (id === 'parameter-modal') window.closeParameterModal();
                    if (id === 'operator-detail-modal') window.closeOperatorDetailModal();
                    if (id === 'group-detail-modal') window.closeGroupDetailModal();
                }
            });
        }
    });
}

function getFilterDateRange() {
    const inputId = currentTab === 'individual' ? 'date-range-filter-ind' : 'date-range-filter-grp';
    const input = document.getElementById(inputId);
    if (!input) return null;
    const fp = input._flatpickr;
    if (fp && fp.selectedDates.length === 2) {
        return { start: fp.selectedDates[0], end: fp.selectedDates[1] };
    }
    return null;
}

function getFilteredData() {
    if (!performanceData) return [];
    const dateRange = getFilterDateRange();

    if (currentTab === 'individual') {
        const exhibition = document.getElementById('filter-exhibition-ind')?.value || 'all';
        const group = document.getElementById('filter-group-ind')?.value || 'all';
        const status = document.getElementById('filter-status-ind')?.value || 'all';
        const activity = document.getElementById('filter-activity-ind')?.value || 'all';
        const quality = document.getElementById('filter-quality-ind')?.value || 'all';
        const keyword = document.getElementById('filter-keyword-ind')?.value?.toLowerCase() || '';

        let operators = JSON.parse(JSON.stringify(performanceData.operators));
        return operators.filter(op => {
            if (dateRange && op.history) {
                const filteredHistory = op.history.filter(h => {
                    const hDate = new Date(h.date);
                    return hDate >= dateRange.start && hDate <= dateRange.end;
                });
                let newProcessed = 0, newErrors = 0;
                filteredHistory.forEach(h => {
                    newProcessed += h.processed;
                    newErrors += Math.round((h.errorRate * h.processed) / 100);
                });
                op.processed = newProcessed;
                op.errors = newErrors;
                op.valid = newProcessed - newErrors;
                op.estPayment = op.valid * (performanceData.parameters.unitPrice || 0);
                const totalSeconds = op.avgTime * newProcessed;
                const h = Math.floor(totalSeconds / 3600);
                const m = Math.floor((totalSeconds % 3600) / 60);
                const s = totalSeconds % 60;
                op.workTime = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
                op.history = filteredHistory;
            }
            if (exhibition !== 'all' && !op.group.includes(exhibition === 'ex_a' ? '展示会A' : 'セミナーB')) return false;
            if (group !== 'all' && !op.group.includes(group === 'gr_a' ? '展示会A' : 'セミナーB')) return false;
            if (status !== 'all' && op.status !== (status === 'achieved' ? '達成' : '未達')) return false;
            if (activity !== 'all' && (activity === 'active' ? op.processed === 0 : op.processed > 0)) return false;
            
            // Quality Filter
            if (quality !== 'all') {
                const acc = op.processed > 0 ? (100 - (op.errors / op.processed * 100)) : 0;
                if (quality === 'high' && acc < 99) return false;
                if (quality === 'low' && acc >= 95) return false;
            }

            if (keyword && !`${op.name} ${op.id} ${op.group}`.toLowerCase().includes(keyword)) return false;
            return true;
        });
    } else {
        const status = document.getElementById('filter-status-grp')?.value || 'all';
        const scale = document.getElementById('filter-scale-grp')?.value || 'all';
        const cost = document.getElementById('filter-cost-grp')?.value || 'all';
        const ontime = document.getElementById('filter-ontime-grp')?.value || 'all';
        const keyword = document.getElementById('filter-keyword-grp')?.value?.toLowerCase() || '';

        return performanceData.groups.filter(grp => {
            if (status !== 'all') {
                const isHigh = grp.costPerformance >= 1.0 || grp.onTimeRate >= 99;
                const isLow = grp.onTimeRate < 96 || grp.qualityVariance > 1.5;
                if (status === 'high' && !isHigh) return false;
                if (status === 'low' && !isLow) return false;
            }
            if (scale !== 'all') {
                if (scale === 'large' && grp.totalUsers < 20) return false;
                if (scale === 'medium' && (grp.totalUsers < 10 || grp.totalUsers >= 20)) return false;
                if (scale === 'small' && grp.totalUsers >= 10) return false;
            }
            if (cost !== 'all') {
                if (cost === 'good' && grp.costPerformance < 1.0) return false;
                if (cost === 'normal' && (grp.costPerformance < 0.8 || grp.costPerformance >= 1.0)) return false;
                if (cost === 'bad' && grp.costPerformance >= 0.8) return false;
            }
            // On-time Rate Filter
            if (ontime !== 'all') {
                if (ontime === 'perfect' && grp.onTimeRate < 100) return false;
                if (ontime === 'low' && grp.onTimeRate >= 98) return false;
            }

            if (keyword && !grp.name.toLowerCase().includes(keyword)) return false;
            return true;
        });
    }
}

function exportCSV(data) {
    if (!data || data.length === 0) { alert('出力対象のデータがありません。'); return; }
    let csvContent = "\uFEFF";
    const dateRange = document.getElementById(currentTab === 'individual' ? 'date-range-filter-ind' : 'date-range-filter-grp')?.value;
    let fileName = `${CONFIG.CSV_FILENAME_PREFIX}_${currentTab}_${new Date().toISOString().slice(0,10)}.csv`;
    if (dateRange) fileName = `${CONFIG.CSV_FILENAME_PREFIX}_${currentTab}_${dateRange.replace(/\s/g, '').replace(/\//g, '')}.csv`;

    if (currentTab === 'individual') {
        csvContent += "システムID,オペレーター名,所属グループ,入力完了数,エラー件数,有効作業数,作業時間,平均処理時間(秒),推定報酬額(円),達成状況,日付,日次完了数,日次エラー率(%)\n";
        data.forEach(op => {
            if (op.history && op.history.length > 0) {
                op.history.forEach(h => { csvContent += `"${op.id}","${op.name}","${op.group}",${op.processed},${op.errors},${op.valid},"${op.workTime}",${op.avgTime},${op.estPayment},"${op.status}","${h.date}",${h.processed},${h.errorRate}\n`; });
            } else {
                csvContent += `"${op.id}","${op.name}","${op.group}",${op.processed},${op.errors},${op.valid},"${op.workTime}",${op.avgTime},${op.estPayment},"${op.status}","N/A",0,0\n`;
            }
        });
    } else {
        csvContent += "グループID,グループ名,稼働人数,登録人数,最大処理能力(枚/日),平均処理時間(秒/枚),品質ばらつき,コスパ(枚/円),納期遵守率(%),オペレーター名,オペレーターAvgTime,オペレーター正確さ\n";
        data.forEach(grp => {
            if (grp.operators && grp.operators.length > 0) {
                grp.operators.forEach(op => { csvContent += `"${grp.id}","${grp.name}",${grp.activeUsers},${grp.totalUsers},${grp.maxCapacity},${grp.avgTime},${grp.qualityVariance},${grp.costPerformance},${grp.onTimeRate},"${op.name}",${op.avgTime},${op.accuracy}\n`; });
            } else {
                csvContent += `"${grp.id}","${grp.name}",${grp.activeUsers},${grp.totalUsers},${grp.maxCapacity},${grp.avgTime},${grp.qualityVariance},${grp.costPerformance},${grp.onTimeRate},"N/A",0,0\n`;
            }
        });
    }
    downloadCSV(csvContent, fileName);
}

function downloadCSV(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function getGlobalAverages() {
    if (!performanceData || !performanceData.operators) return { avgTime: 0, errorRate: 0 };
    const ops = performanceData.operators;
    const totalAvgTime = ops.reduce((sum, op) => sum + op.avgTime, 0);
    const totalErrorRate = ops.reduce((sum, op) => sum + ((op.errors / op.processed) * 100), 0);
    return { avgTime: Math.round(totalAvgTime / ops.length), errorRate: totalErrorRate / ops.length };
}

function showOperatorDetail(id) {
    const op = performanceData.operators.find(o => o.id === id);
    if (!op) return;
    const modal = document.getElementById('operator-detail-modal');
    if (!modal) return;
    document.getElementById('op-detail-name').textContent = op.name;
    document.getElementById('op-detail-group').textContent = op.group;
    document.getElementById('op-detail-processed').textContent = op.processed.toLocaleString();
    document.getElementById('op-detail-error-rate').textContent = ((op.errors / op.processed) * 100).toFixed(2) + '%';
    document.getElementById('op-detail-valid').textContent = op.valid.toLocaleString();
    document.getElementById('op-detail-avg-time').textContent = op.avgTime + 's';
    document.getElementById('op-detail-payment').textContent = '¥' + op.estPayment.toLocaleString();
    document.getElementById('op-detail-ontime').textContent = op.onTimeRate + '%';
    document.getElementById('op-detail-correction-cost').textContent = '¥' + (op.errors * (performanceData.parameters.correctionCost || 0)).toLocaleString();
    document.getElementById('op-detail-last-active').textContent = op.history && op.history.length > 0 ? [...op.history].sort((a,b)=>new Date(a.date)-new Date(b.date))[op.history.length-1].date : '-';
    const globalAvg = getGlobalAverages();
    const diffTime = op.avgTime - globalAvg.avgTime;
    const diffEl = document.getElementById('op-detail-avg-diff');
    diffEl.textContent = `(${Math.abs(diffTime)}s ${diffTime < 0 ? '速い' : '遅い'})`;
    diffEl.className = `text-[10px] ml-2 font-bold ${diffTime < 0 ? 'text-success' : 'text-error'}`;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    initOperatorCharts(op);
}

function closeOperatorDetailModal() {
    const modal = document.getElementById('operator-detail-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function showGroupDetail(id) {
    const group = performanceData.groups.find(g => g.id === id);
    if (!group) return;
    const modal = document.getElementById('group-detail-modal');
    if (!modal) return;
    document.getElementById('group-detail-name').textContent = group.name;
    document.getElementById('group-detail-active').textContent = group.activeUsers;
    document.getElementById('group-detail-capacity').textContent = group.maxCapacity.toLocaleString();
    document.getElementById('group-detail-avg-time').textContent = group.avgTime + 's';
    document.getElementById('group-detail-cpy').textContent = group.costPerformance;
    let totalPayment = 0;
    if (group.operators) group.operators.forEach(gOp => { const fullOp = performanceData.operators.find(o => o.name === gOp.name); if (fullOp) totalPayment += fullOp.estPayment; });
    document.getElementById('group-detail-total-payment').textContent = '¥' + totalPayment.toLocaleString();
    const opList = document.getElementById('group-op-list');
    opList.innerHTML = group.operators.map(gOp => {
        const fullOp = performanceData.operators.find(o => o.name === gOp.name) || {};
        return `<tr class="text-xs hover:bg-surface-variant/30"><td class="px-3 py-2 font-medium">${gOp.name}</td><td class="px-3 py-2 text-center">${(fullOp.processed || 0).toLocaleString()}</td><td class="px-3 py-2 text-center">${gOp.avgTime}s</td><td class="px-3 py-2 text-center ${gOp.accuracy < CONFIG.THRESHOLD_ACCURACY ? 'text-error font-bold' : ''}">${gOp.accuracy}%</td><td class="px-3 py-2 text-center">¥${(fullOp.estPayment || 0).toLocaleString()}</td></tr>`;
    }).join('');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    initGroupScatterPlot(group);
    initGroupTrendChart(group);
}

function closeGroupDetailModal() {
    const modal = document.getElementById('group-detail-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function showParameterModal() {
    const modal = document.getElementById('parameter-modal');
    if (!modal) return;
    const p = performanceData.parameters;
    document.getElementById('param-target-processed').value = p.targetProcessed;
    document.getElementById('param-target-error').value = p.targetErrorRate;
    document.getElementById('param-target-time').value = p.targetAvgTime;
    document.getElementById('param-unit-price').value = p.unitPrice;
    document.getElementById('param-correction-cost').value = p.correctionCost;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeParameterModal() {
    const modal = document.getElementById('parameter-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function saveParameters() {
    performanceData.parameters.targetProcessed = parseInt(document.getElementById('param-target-processed').value);
    performanceData.parameters.targetErrorRate = parseFloat(document.getElementById('param-target-error').value);
    performanceData.parameters.targetAvgTime = parseInt(document.getElementById('param-target-time').value);
    performanceData.parameters.unitPrice = parseInt(document.getElementById('param-unit-price').value);
    performanceData.parameters.correctionCost = parseInt(document.getElementById('param-correction-cost').value);
    alert('指標設定を保存しました。');
    closeParameterModal();
    renderTables();
}

function downloadOperatorCSV() {
    const name = document.getElementById('op-detail-name').textContent;
    const op = performanceData.operators.find(o => o.name === name);
    if (op) {
        let csvContent = "\uFEFFシステムID,オペレーター名,所属グループ,入力完了数,エラー件数,有効作業数,作業時間,平均処理時間(秒),推定報酬額(円),達成状況,日付,日次完了数,日次エラー率(%)\n";
        if (op.history) op.history.forEach(h => { csvContent += `"${op.id}","${op.name}","${op.group}",${op.processed},${op.errors},${op.valid},"${op.workTime}",${op.avgTime},${op.estPayment},"${op.status}","${h.date}",${h.processed},${h.errorRate}\n`; });
        downloadCSV(csvContent, `operator_${op.id}_${new Date().toISOString().slice(0,10)}.csv`);
    }
}

function downloadGroupCSV() {
    const name = document.getElementById('group-detail-name').textContent;
    const grp = performanceData.groups.find(g => g.name === name);
    if (grp) {
        let csvContent = "\uFEFFグループID,グループ名,稼働人数,登録人数,最大処理能力(枚/日),平均処理時間(秒/枚),品質ばらつき,コスパ(枚/円),納期遵守率(%),オペレーター名,オペレーターAvgTime,オペレーター正確さ\n";
        if (grp.operators) grp.operators.forEach(op => { csvContent += `"${grp.id}","${grp.name}",${grp.activeUsers},${grp.totalUsers},${grp.maxCapacity},${grp.avgTime},${grp.qualityVariance},${grp.costPerformance},${grp.onTimeRate},"${op.name}",${op.avgTime},${op.accuracy}\n`; });
        downloadCSV(csvContent, `group_${grp.id}_${new Date().toISOString().slice(0,10)}.csv`);
    }
}

function initGroupTrendChart(group) {
    const ctx = document.getElementById('group-trend-chart').getContext('2d');
    if (groupTrendChart) groupTrendChart.destroy();
    const dailyCounts = {};
    if (group.operators) group.operators.forEach(gOp => { const fullOp = performanceData.operators.find(o => o.name === gOp.name); if (fullOp && fullOp.history) fullOp.history.forEach(h => { dailyCounts[h.date] = (dailyCounts[h.date] || 0) + h.processed; }); });
    const labels = Object.keys(dailyCounts).sort();
    groupTrendChart = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: '処理枚数', data: labels.map(d => dailyCounts[d]), borderColor: '#4285F4', backgroundColor: 'rgba(66, 133, 244, 0.1)', fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } });
}

function initGroupScatterPlot(group) {
    const ctx = document.getElementById('group-scatter-chart').getContext('2d');
    if (groupScatterChart) groupScatterChart.destroy();
    groupScatterChart = new Chart(ctx, { type: 'scatter', data: { datasets: [{ label: 'オペレーター', data: group.operators.map(op => ({ x: op.avgTime, y: op.accuracy, name: op.name })), backgroundColor: '#4285F4', pointRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: 10 }, plugins: { tooltip: { callbacks: { label: (c) => `${c.raw.name}: ${c.raw.x}s, ${c.raw.y}%` } } }, scales: { x: { title: { display: true, text: '平均時間(s)' } }, y: { title: { display: true, text: '正確さ(%)' }, min: 90, max: 100 } } } });
}

function initOperatorCharts(op) {
    const ctxC = document.getElementById('op-combo-chart').getContext('2d'), ctxR = document.getElementById('op-radar-chart').getContext('2d');
    if (opComboChart) opComboChart.destroy(); if (opRadarChart) opRadarChart.destroy();
    const labels = op.history.map(h => h.date);
    opComboChart = new Chart(ctxC, { type: 'bar', data: { labels: labels, datasets: [{ label: '枚数', data: op.history.map(h=>h.processed), backgroundColor: 'rgba(66, 133, 244, 0.6)', yAxisID: 'y' }, { label: 'エラー率(%)', data: op.history.map(h=>h.errorRate), type: 'line', borderColor: '#D32F2F', yAxisID: 'y1' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } } });
    const errL = Object.keys(op.errorTypes), errD = Object.values(op.errorTypes);
    opRadarChart = new Chart(ctxR, { type: 'radar', data: { labels: errL.map(k=>({name:'氏名',company:'会社',address:'住所',phone:'電話',email:'メール'}[k]||k)), datasets: [{ label: 'エラー傾向', data: errD, backgroundColor: 'rgba(66, 133, 244, 0.2)', borderColor: '#4285F4' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: Math.max(...errD)+1 } } } });
}