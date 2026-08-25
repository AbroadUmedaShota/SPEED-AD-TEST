// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/calendar-management.html の inline script。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

export function initCalendarManagementPage() {
    const state = {
        currentDate: new Date(),
        holidays: {},
        manualSettings: [],
        updateLog: [],
        surveys: [],
        operators: [],
        manualSettingsCurrentPage: 1,
        manualSettingsItemsPerPage: 9,
        logCurrentPage: 1,
        logItemsPerPage: 7,
        settingToDeleteId: null,
        urgencyOverrides: {},
        assignmentOverrides: {},
        currentModalDate: null,
        // Additions for drag selection
        isDragging: false,
        dragStartDate: null,
        dragEndDate: null,
        memos: {},
        currentFocusStartDate: null,
        currentFocusEndDate: null,
        currentView: 'monthly',
    };

    // Declare variables for DOM elements
    let calendarTitle, calendarGrid, prevMonthButton, nextMonthButton, manualSettingsTableBody,
        settingPageInfo, settingPrevButton, settingNextButton, updateLogTableBody, logPageInfo,
        logPrevButton, logNextButton, kpiHolidays, kpiSubstituteWorkdays, kpiSlaAlerts,
        // Modals to keep
        confirmationModal, confirmationModalContainer,
        confirmationModalMessage, closeConfirmationModalButton, deleteConfirmModal,
        deleteConfirmModalContainer, cancelDeleteButton, confirmDeleteButton,
        calendarTooltip,
        // View containers and buttons
        monthlyView, yearlyView, verticalView,
        viewMonthlyButton, viewVerticalButton, viewYearlyButton;


    // --- Data Fetching ---
    async function fetchData() {
        try {
            const [holidaysRes, manualSettingsRes, logRes, surveysRes, operatorsRes] = await Promise.all([
                fetch('../../data/admin/holidays.json'),
                fetch('../../data/admin/manual_calendar_settings.json'),
                fetch('../../data/admin/calendar_update_log.json'),
                fetch('../../data/admin/surveys.json'),
                fetch('../../data/admin/operators.json'),
            ]);
            state.holidays = await holidaysRes.json();
            state.manualSettings = await manualSettingsRes.json();
            state.updateLog = await logRes.json();
            state.surveys = await surveysRes.json();
            state.operators = await operatorsRes.json();
        } catch (error) {
            console.error("Failed to fetch initial data:", error);
        }
    }

    // --- Rendering & UI ---
    function renderAll() {
        switch (state.currentView) {
            case 'monthly':
                renderCalendar();
                break;
            case 'yearly':
                renderYearlyCalendar();
                break;
            case 'vertical':
                renderVerticalCalendar();
                break;
        }
        renderManualSettings();
        renderUpdateLog();
        updateKPIs();
    }

    function switchView(viewName) {
        state.currentView = viewName;

        // Toggle view containers using direct style manipulation for robustness
        document.getElementById('monthly-view').style.display = 'none';
        document.getElementById('yearly-view').style.display = 'none';
        document.getElementById('vertical-view').style.display = 'none';

        const activeView = document.getElementById(`${viewName}-view`);
        if (activeView) {
            // Yearly view uses display:grid, others use block.
            activeView.style.display = viewName === 'yearly' ? 'grid' : 'block';
        }

        // Toggle buttons
        [viewMonthlyButton, viewVerticalButton, viewYearlyButton].forEach(b => b.classList.remove('active'));
        const activeButton = document.getElementById(`view-${viewName}-button`);
        if (activeButton) activeButton.classList.add('active');

        renderAll();
    }

    function renderYearlyCalendar() {
        document.getElementById('monthly-view').style.display = 'none';
        document.getElementById('vertical-view').style.display = 'none';
        const year = state.currentDate.getFullYear();
        yearlyView.innerHTML = '';
        calendarTitle.textContent = `${year}年`;

        for (let month = 0; month < 12; month++) {
            const monthContainer = document.createElement('div');
            monthContainer.className = 'year-month-container';

            const monthHeader = document.createElement('h3');
            monthHeader.className = 'year-month-header';
            monthHeader.textContent = `${month + 1}月`;
            monthContainer.appendChild(monthHeader);

            const dayGrid = document.createElement('div');
            dayGrid.className = 'year-day-grid';

            ['日', '月', '火', '水', '木', '金', '土'].forEach(day => {
                const dayEl = document.createElement('div');
                dayEl.className = 'text-xs font-bold text-center text-on-surface-variant';
                dayEl.textContent = day;
                dayGrid.appendChild(dayEl);
            });

            const firstDay = new Date(year, month, 1);
            const startingDay = firstDay.getDay();

            for (let i = 0; i < startingDay; i++) {
                dayGrid.appendChild(document.createElement('div'));
            }

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const dayCell = document.createElement('div');
                dayCell.textContent = day;
                dayCell.dataset.date = dateString;
                dayCell.className = 'year-day-cell';
                dayCell.style.pointerEvents = 'auto';

                const surveysForDay = getSurveysForDay(dateString);
                if (isDayAssigned(dateString)) {
                    dayCell.classList.add('is-assigned');
                } else if (surveysForDay.length > 0) {
                    dayCell.classList.add('has-survey');
                }

                const dayOfWeek = date.getDay();
                let { status: dayStatus } = getDayStatus(dateString, dayOfWeek);
                const hasOnDemand = surveysForDay.some(s => s.type === 'on-demand');

                if (hasOnDemand && dayStatus === 'HOLIDAY') {
                    dayStatus = 'WORKDAY'; // Override status to prevent holiday styling
                }

                if (dayOfWeek === 0) dayCell.classList.add('sunday');
                if (dayOfWeek === 6) dayCell.classList.add('saturday');
                if (dayStatus === 'HOLIDAY' && dayOfWeek !== 0) dayCell.classList.add('holiday');

                dayGrid.appendChild(dayCell);
            }

            monthContainer.appendChild(dayGrid);
            yearlyView.appendChild(monthContainer);
        }
    }

    function renderVerticalCalendar() {
        document.getElementById('monthly-view').style.display = 'none';
        document.getElementById('yearly-view').style.display = 'none';
        verticalView.innerHTML = '';
        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();
        calendarTitle.textContent = `${year}年${month + 1}月`;

        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            const row = document.createElement('div');
            row.className = 'vertical-day-row';
            row.style.cursor = 'pointer';
            row.dataset.date = dateString;

            const dateEl = document.createElement('div');
            dateEl.className = 'vertical-day-date';
            dateEl.textContent = `${month + 1}/${day}`;
            row.appendChild(dateEl);

            const contentEl = document.createElement('div');
            contentEl.className = 'vertical-day-content';

            let { status: dayStatus } = getDayStatus(dateString, date.getDay());
            const surveysForDay = getSurveysForDay(dateString);
            const isAssigned = isDayAssigned(dateString);
            const hasOnDemand = surveysForDay.some(s => s.type === 'on-demand');

            let statusHTML = '';
            if (hasOnDemand && dayStatus === 'HOLIDAY') {
                statusHTML = `<span class="text-xs font-semibold text-error">営業日</span>`;
            } else if (dayStatus === 'HOLIDAY') {
                statusHTML = `<span class="text-xs font-semibold text-error">休業日</span>`;
            } else if (dayStatus === 'SUBSTITUTE_WORKDAY') {
                statusHTML = `<span class="text-xs font-semibold text-primary">振替営業日</span>`;
            } else if (dayStatus === 'WORKDAY') {
                statusHTML = `<span class="text-xs font-semibold text-green-600">営業日</span>`;
            }

            const normalIndicator = `<span class="text-xs border rounded px-1 py-0.5 ${isAssigned ? 'bg-green-100 border-green-300 text-green-800' : 'bg-pink-100 border-pink-300 text-pink-800'}">⭐通常</span>`;
            const onDemandIndicator = `<span class="text-xs border rounded border-error text-error px-1 py-0.5">⚡オンデマンド</span>`;

            let surveyHTML = surveysForDay.map(s => {
                const indicator = s.type === 'on-demand' ? onDemandIndicator : normalIndicator;
                return `<div class="flex items-center gap-2 text-xs py-0.5"><span>${s.name}</span>${indicator}</div>`;
            }).join('');

            contentEl.innerHTML = `${statusHTML}${surveyHTML}`;
            row.appendChild(contentEl);

            verticalView.appendChild(row);
        }
    }

    function renderCalendar() {
        document.getElementById('yearly-view').style.display = 'none';
        document.getElementById('vertical-view').style.display = 'none';
        calendarGrid.innerHTML = '';
        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();
        calendarTitle.textContent = `${year}年${month + 1}月`;

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const firstDayOfWeek = firstDayOfMonth.getDay();
        const totalDays = lastDayOfMonth.getDate();

        for (let i = 0; i < firstDayOfWeek; i++) {
            calendarGrid.appendChild(document.createElement('div'));
        }

        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const dayCell = document.createElement('div');
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            let { status: dayStatus } = getDayStatus(dateString, date.getDay());
            const surveysForDay = getSurveysForDay(dateString);
            const memoForDay = state.memos && state.memos[dateString];
            const isAssigned = isDayAssigned(dateString);
            const hasOnDemand = surveysForDay.some(s => s.type === 'on-demand');
            const hasNormal = surveysForDay.some(s => s.type === 'normal');

            let isSpecialOnDemandWorkday = false;
            if (hasOnDemand && dayStatus === 'HOLIDAY') {
                dayStatus = 'WORKDAY'; // Override status for logic below
                isSpecialOnDemandWorkday = true;
            }

            let cellClasses = 'border rounded-lg min-h-[120px] p-2 cursor-pointer hover:bg-surface-variant/60 relative';
            if (hasOnDemand) {
                cellClasses += isAssigned ? ' bg-green-50' : ' bg-pink-50';
            } else if (dayStatus === 'HOLIDAY') {
                cellClasses += ' bg-surface-container-lowest';
            }

            let dayTypeIndicatorHTML = '';
            if (isSpecialOnDemandWorkday) {
                dayTypeIndicatorHTML = `<span class="text-xs font-semibold text-error">営業日</span>`;
            } else if (dayStatus === 'HOLIDAY') {
                dayTypeIndicatorHTML = `<span class="text-xs font-semibold text-error">休業日</span>`;
            } else if (dayStatus === 'SUBSTITUTE_WORKDAY') {
                dayTypeIndicatorHTML = `<span class="text-xs font-semibold text-primary">振替営業日</span>`;
            } else {
                dayTypeIndicatorHTML = `<span class="text-xs font-semibold text-green-600">営業日</span>`;
            }

            let surveyTypeIndicatorHTML = '';
            const normalIndicator = `<span class="text-xs border rounded px-1 py-0.5 ${isAssigned ? 'bg-green-100 border-green-300 text-green-800' : 'bg-pink-100 border-pink-300 text-pink-800'}">⭐通常</span>`;
            const onDemandIndicator = `<span class="text-xs border rounded border-error text-error px-1 py-0.5">⚡オンデマンド</span>`;

            if (hasNormal && hasOnDemand) {
                surveyTypeIndicatorHTML = `
                    <div class="flex flex-col items-end space-y-1">
                        ${normalIndicator}
                        ${onDemandIndicator}
                    </div>
                `;
            } else if (hasNormal) {
                surveyTypeIndicatorHTML = normalIndicator;
            } else if (hasOnDemand) {
                surveyTypeIndicatorHTML = onDemandIndicator;
            }

            let surveyItemsHTML = '';
            if (surveysForDay.length > 0) {
                surveyItemsHTML = '<ul class="mt-1 space-y-1">';
                surveysForDay.slice(0, 2).forEach(survey => {
                    const surveyName = survey.name.length > 12 ? survey.name.substring(0, 12) + '...' : survey.name;
                    surveyItemsHTML += `<li class="text-xs text-on-surface-variant truncate" title="${survey.name}">${surveyName}</li>`;
                });
                if (surveysForDay.length > 2) {
                    surveyItemsHTML += `<li class="text-xs text-on-surface-variant">他${surveysForDay.length - 2}件...</li>`;
                }
                surveyItemsHTML += '</ul>';
            }

            let dayColor = 'text-on-surface';
            if (date.getDay() === 0) dayColor = 'text-error';
            if (date.getDay() === 6) dayColor = 'text-primary';

            const memoIconHTML = memoForDay ? '<span class="material-icons text-sm text-on-surface-variant">📌</span>' : '';

            dayCell.className = cellClasses;
            dayCell.dataset.date = dateString;
            dayCell.innerHTML = `
                <div class="flex justify-between items-start ${dayColor} font-medium">
                    <div class="flex items-center gap-1">
                        <span>${day}</span>
                    </div>
                    <div class="text-xs">${dayTypeIndicatorHTML}</div>
                </div>
                ${surveyItemsHTML}
                <div class="absolute bottom-2 right-2 flex items-end gap-1">
                    ${memoIconHTML}
                    ${surveyTypeIndicatorHTML}
                </div>
            `;
            
            calendarGrid.appendChild(dayCell);
        }
        updateSelectionHighlight();
    }

    function renderManualSettings() {
        manualSettingsTableBody.innerHTML = '';
        const sortedSettings = state.manualSettings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const totalPages = Math.ceil(sortedSettings.length / state.manualSettingsItemsPerPage);
        settingPageInfo.textContent = `${state.manualSettingsCurrentPage} / ${totalPages || 1}`;

        if (sortedSettings.length === 0) {
            manualSettingsTableBody.innerHTML = '<tr><td colspan="4" class="px-4 py-3 text-center">個別設定はありません。</td></tr>';
            settingPrevButton.disabled = true;
            settingNextButton.disabled = true;
            return;
        }

        const start = (state.manualSettingsCurrentPage - 1) * state.manualSettingsItemsPerPage;
        const end = start + state.manualSettingsItemsPerPage;
        const pageItems = sortedSettings.slice(start, end);

        pageItems.forEach(setting => {
            const tr = document.createElement('tr');
            const typeText = setting.event_type === 'HOLIDAY' ? '特別休業日' : '振替営業日';
            const typeClass = setting.event_type === 'HOLIDAY' ? 'text-error' : 'text-primary';

            tr.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap font-medium">${setting.event_date}</td>
                <td class="px-4 py-3 whitespace-nowrap ${typeClass}">${typeText}</td>
                <td class="px-4 py-3">${setting.reason || '-'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right">
                    <button data-id="${setting.id}" class="edit-setting-button inline-flex items-center gap-1 rounded border border-outline px-3 py-1 text-xs hover:bg-surface-variant">編集</button>
                    <button data-id="${setting.id}" class="delete-setting-button inline-flex items-center gap-1 rounded border border-error/50 text-error px-3 py-1 text-xs hover:bg-error-container">削除</button>
                </td>
            `;
            manualSettingsTableBody.appendChild(tr);
        });

        settingPrevButton.disabled = state.manualSettingsCurrentPage === 1;
        settingNextButton.disabled = state.manualSettingsCurrentPage === totalPages;
    }

    function renderUpdateLog() {
        updateLogTableBody.innerHTML = '';
        const sortedLog = state.updateLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const totalPages = Math.ceil(sortedLog.length / state.logItemsPerPage);
        logPageInfo.textContent = `${state.logCurrentPage} / ${totalPages || 1}`;

        if (sortedLog.length === 0) {
            updateLogTableBody.innerHTML = '<tr><td colspan="3" class="px-4 py-3 text-center">更新ログはありません。</td></tr>';
            logPrevButton.disabled = true;
            logNextButton.disabled = true;
            return;
        }

        const start = (state.logCurrentPage - 1) * state.logItemsPerPage;
        const end = start + state.logItemsPerPage;
        const pageItems = sortedLog.slice(start, end);

        pageItems.forEach(log => {
            const tr = document.createElement('tr');
            const timestamp = new Date(log.timestamp).toLocaleString('ja-JP');
            
            tr.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap">${timestamp}</td>
                <td class="px-4 py-3 whitespace-nowrap">${log.user}</td>
                <td class="px-4 py-3">${log.action}</td>
            `;
            updateLogTableBody.appendChild(tr);
        });

        logPrevButton.disabled = state.logCurrentPage === 1;
        logNextButton.disabled = state.logCurrentPage === totalPages;
    }
    
    function updateKPIs() {
        const year = state.currentDate.getFullYear();
        const month = state.currentDate.getMonth();
        let holidayCount = 0, substituteCount = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const { status } = getDayStatus(dateString, date.getDay());
            if (status === 'HOLIDAY') holidayCount++;
            else if (status === 'SUBSTITUTE_WORKDAY') substituteCount++;
        }
        kpiHolidays.textContent = `${holidayCount}日`;
        kpiSubstituteWorkdays.textContent = `${substituteCount}日`;
        kpiSlaAlerts.textContent = '3件';
    }

    function setActiveTab(tabName) {
        const focusArea = document.getElementById('focus-area');
        focusArea.querySelectorAll('.tab-button').forEach(button => {
            const isSelected = button.dataset.tab === tabName;
            button.classList.toggle('border-primary', isSelected);
            button.classList.toggle('text-primary', isSelected);
            button.classList.toggle('border-transparent', !isSelected);
            button.classList.toggle('text-on-surface-variant', !isSelected);
        });
        focusArea.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `tab-panel-${tabName}`);
        });
    }

    function openFocusArea(startDate, endDate = null) {
        const focusArea = document.getElementById('focus-area');
        if (!focusArea) return;

        state.currentFocusStartDate = startDate;
        state.currentFocusEndDate = endDate;

        // Update selection on calendar
        state.dragStartDate = startDate;
        state.dragEndDate = endDate || startDate;
        updateSelectionHighlight();

        document.getElementById('focus-area-title').textContent = endDate ? "期間設定" : "詳細";
        document.getElementById('focus-area-date').textContent = endDate ? `${startDate} から ${endDate}` : startDate;

        const surveysInRange = getSurveysForRange(startDate, endDate || startDate);
        const detailsContent = document.getElementById('focus-details-content');
        if (surveysInRange.length > 0) {
            detailsContent.innerHTML = surveysInRange.map(survey => `
                <div class="p-3 rounded-lg bg-surface-container">
                    <div class="flex justify-between items-center">
                        <p class="font-semibold text-on-surface">${survey.name}</p>
                        <span class="text-xs font-medium ${survey.type === 'on-demand' ? 'text-error' : 'text-on-surface-variant'}">${survey.type === 'on-demand' ? 'オンデマンド' : '通常'}</span>
                    </div>
                    <p class="text-sm text-on-surface-variant mt-1">期間: ${survey.startDate} ~ ${survey.endDate}</p>
                    <p class="text-sm text-on-surface-variant mt-1">見込枚数: ${(survey.expected_cards || 0).toLocaleString()}</p>
                </div>
            `).join('');
        } else {
            detailsContent.innerHTML = `<p class="text-sm text-on-surface-variant">${endDate ? 'この期間に' : 'この日に'}アンケートはありません。</p>`;
        }

        const assignContent = document.getElementById('focus-assign-content');
        const companyName = state.operators.length > 0 ? state.operators[0].company : 'N/A';
        const isAssigned = isRangeAssigned(startDate, endDate || startDate);
        
        let assignButtonsHTML = '';
        const assignButtonText = endDate ? 'この期間にまとめてアサイン' : 'この日にアサイン';
        const unassignButtonText = endDate ? 'この期間のアサインをまとめて解除' : 'アサインを解除';

        if (isAssigned) {
            assignButtonsHTML = `<button id="cancel-assignment-button" class="mt-4 w-full rounded-lg bg-error text-white px-4 py-2 text-sm font-semibold">${unassignButtonText}</button>`;
        } else {
            assignButtonsHTML = `<button id="save-assignment-button" class="mt-4 w-full rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-semibold" ${surveysInRange.length === 0 ? 'disabled' : ''}>${assignButtonText}</button>`;
        }
        assignContent.innerHTML = `
            <div>
                <span class="text-sm text-on-surface-variant">担当会社：</span><span class="font-semibold text-on-surface">${companyName}</span>
            </div>
            ${assignButtonsHTML}
        `;

        const memoTextarea = document.getElementById('memo-textarea');
        if (endDate) {
            memoTextarea.value = '';
            memoTextarea.placeholder = '選択した期間のすべての日付に同じメモが保存されます。';
        } else {
            memoTextarea.value = state.memos[startDate] || '';
            memoTextarea.placeholder = 'メモを入力';
        }

        const reasonTextarea = document.getElementById('focus-reason');
        reasonTextarea.value = '';
        if (endDate) {
            document.querySelector(`input[name="focus_event_type"][value="WORKDAY"]`).checked = true;
        } else {
            const manualSetting = state.manualSettings.find(s => s.event_date === startDate);
            let eventType = 'WORKDAY';
            if (manualSetting) {
                eventType = manualSetting.event_type;
                reasonTextarea.value = manualSetting.reason || '';
            }
            const typeRadio = document.querySelector(`input[name="focus_event_type"][value="${eventType}"]`);
            if (typeRadio) typeRadio.checked = true;
            else document.querySelector(`input[name="focus_event_type"][value="WORKDAY"]`).checked = true;
        }

        if (surveysInRange.length > 0) {
            setActiveTab('assign');
        } else {
            setActiveTab('settings');
        }

        document.getElementById('focus-area-close-tab').classList.remove('hidden');
        focusArea.classList.remove('translate-x-full');
    }

    function closeFocusArea() {
        const focusArea = document.getElementById('focus-area');
        if (!focusArea) return;
        document.getElementById('focus-area-close-tab').classList.add('hidden');
        focusArea.classList.add('translate-x-full');
        state.dragStartDate = null;
        state.dragEndDate = null;
        updateSelectionHighlight();
    }

    function showDeleteConfirmModal(settingId) {
        state.settingToDeleteId = settingId;
        deleteConfirmModal.classList.remove('hidden');
        setTimeout(() => deleteConfirmModalContainer.classList.add('opacity-100', 'translate-y-0'), 10);
    }

    function closeDeleteConfirmModal() {
        deleteConfirmModalContainer.classList.remove('opacity-100', 'translate-y-0');
        setTimeout(() => {
            deleteConfirmModal.classList.add('hidden');
            state.settingToDeleteId = null;
        }, 200);
    }

    function handleMonthChange(offset) {
        if (state.currentView === 'yearly') {
            state.currentDate.setFullYear(state.currentDate.getFullYear() + offset);
        } else {
            state.currentDate.setMonth(state.currentDate.getMonth() + offset);
        }
        renderAll();
    }

    function addLogEntry(action, user = 'Admin') {
        state.updateLog.unshift({
            timestamp: new Date().toISOString(),
            user: user,
            action: action,
        });
        state.logCurrentPage = 1;
    }

    // --- Data & State Helpers ---
    function getDayStatus(dateString, dayOfWeek) {
        const manualSetting = state.manualSettings.find(s => s.event_date === dateString);
        if (manualSetting) return { status: manualSetting.event_type, reason: manualSetting.reason };

        const nationalHoliday = state.holidays[dateString.substring(0, 4)]?.find(h => h.date === dateString);
        if (nationalHoliday) return { status: 'HOLIDAY', reason: null };

        if (dayOfWeek === 0 || dayOfWeek === 6) return { status: 'HOLIDAY', reason: null };
        return { status: 'WORKDAY', reason: null };
    }

    function getSurveysForDay(dateString) {
        if (!state.surveys) return [];
        return state.surveys.filter(survey => dateString >= survey.startDate && dateString <= survey.endDate);
    }

    function getSurveysForRange(startDate, endDate) {
        if (!state.surveys) return [];
        const surveysInRange = new Map();
        forEachDateInRange(startDate, endDate, (dateString) => {
            getSurveysForDay(dateString).forEach(survey => surveysInRange.set(survey.id, survey));
        });
        return Array.from(surveysInRange.values());
    }

    function isDayAssigned(dateString) {
        const dayAssignments = state.assignmentOverrides[dateString];
        return dayAssignments && dayAssignments.surveyIds.length > 0;
    }

    function isRangeAssigned(startDate, endDate) {
        let assigned = false;
        // This is a bit of a workaround to allow breaking the loop
        try {
            forEachDateInRange(startDate, endDate, (dateString) => {
                if (isDayAssigned(dateString)) {
                    assigned = true;
                    throw new Error("Found"); // Break the loop
                }
            });
        } catch (e) {
            if (e.message !== "Found") throw e;
        }
        return assigned;
    }

    // --- Drag Selection ---
    function handleDragStart(e) {
        const dayCell = e.target.closest('[data-date]');
        if (dayCell) {
            e.preventDefault();
            state.isDragging = true;
            state.dragStartDate = dayCell.dataset.date;
            state.dragEndDate = dayCell.dataset.date;
            updateSelectionHighlight();
        }
    }

    function handleDrag(e) {
        if (state.isDragging) {
            const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
            if (!elementUnderMouse) return;

            const dayCell = elementUnderMouse.closest('[data-date]');
            if (dayCell && dayCell.dataset.date !== state.dragEndDate) {
                state.dragEndDate = dayCell.dataset.date;
                updateSelectionHighlight();
            }
        }
    }

    function handleDragEnd(e) {
        if (!state.isDragging) return;

        // Final update of dragEndDate based on the mouseup position
        const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
        if (elementUnderMouse) {
            const dayCell = elementUnderMouse.closest('[data-date]');
            if (dayCell) {
                state.dragEndDate = dayCell.dataset.date;
            }
        }

        const wasDragging = state.dragStartDate !== state.dragEndDate;
        state.isDragging = false;
        const { start, end } = getOrderedDateRange();
        if (!start) return; // Guard

        // Open the focus area first
        if (wasDragging) {
            openFocusArea(start, end);
        } else { // Single click
            openFocusArea(start);
        }

        // If the action occurred on a non-monthly view, switch to monthly to show the selection
        if (state.currentView !== 'monthly') {
            state.currentDate = new Date(start);
            // Use a timeout to allow the focus area animation to start before re-rendering the calendar
            setTimeout(() => {
                switchView('monthly');
            }, 50); // A small delay
        }
    }

    function getOrderedDateRange() {
        const { start, end } = { start: state.dragStartDate, end: state.dragEndDate };
        if (!start || !end) return { start: null, end: null };
        return new Date(start) > new Date(end) ? { start: end, end: start } : { start, end };
    }

    function forEachDateInRange(startDate, endDate, callback) {
        // Add T00:00:00Z to treat date strings as UTC, avoiding timezone shifts.
        let currentDate = new Date(startDate + 'T00:00:00Z');
        const lastDate = new Date(endDate + 'T00:00:00Z');

        while (currentDate <= lastDate) {
            const dateString = currentDate.toISOString().split('T')[0];
            callback(dateString);
            // Increment the date in UTC.
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
    }

    function updateSelectionHighlight() {
        // Clear previous selection from all views
        calendarGrid.querySelectorAll('.selection').forEach(cell => cell.classList.remove('selection', 'border-2', 'border-blue-500'));
        yearlyView.querySelectorAll('.selection').forEach(cell => cell.classList.remove('selection', 'bg-blue-300', 'text-white'));
        verticalView.querySelectorAll('.selection').forEach(cell => cell.classList.remove('selection', 'bg-blue-100'));

        if (!state.dragStartDate || !state.dragEndDate) return;
        const { start, end } = getOrderedDateRange();
        if (!start || !end) return;

        forEachDateInRange(start, end, (dateString) => {
            let cell;
            switch (state.currentView) {
                case 'monthly':
                    cell = calendarGrid.querySelector(`[data-date="${dateString}"]`);
                    if (cell) cell.classList.add('selection', 'border-2', 'border-blue-500');
                    break;
                case 'yearly':
                    cell = yearlyView.querySelector(`[data-date="${dateString}"]`);
                    if (cell) cell.classList.add('selection', 'bg-blue-300', 'text-white');
                    break;
                case 'vertical':
                    cell = verticalView.querySelector(`[data-date="${dateString}"]`);
                    if (cell) cell.classList.add('selection', 'bg-blue-100');
                    break;
            }
        });
    }



    async function init() {
        // Assign DOM elements
        calendarTitle = document.getElementById('calendar-title');
        calendarGrid = document.getElementById('calendar-grid');
        prevMonthButton = document.getElementById('prev-month-button');
        nextMonthButton = document.getElementById('next-month-button');
        manualSettingsTableBody = document.getElementById('manual-settings-table-body');
        settingPageInfo = document.getElementById('setting-page-info');
        settingPrevButton = document.getElementById('setting-prev-button');
        settingNextButton = document.getElementById('setting-next-button');
        updateLogTableBody = document.getElementById('update-log-table-body');
        logPageInfo = document.getElementById('log-page-info');
        logPrevButton = document.getElementById('log-prev-button');
        logNextButton = document.getElementById('log-next-button');
        kpiHolidays = document.getElementById('kpi-holidays');
        kpiSubstituteWorkdays = document.getElementById('kpi-substitute-workdays');
        kpiSlaAlerts = document.getElementById('kpi-sla-alerts');
        deleteConfirmModal = document.getElementById('delete-confirm-modal');
        deleteConfirmModalContainer = document.getElementById('delete-confirm-modal-container');
        cancelDeleteButton = document.getElementById('cancel-delete-button');
        confirmDeleteButton = document.getElementById('confirm-delete-button');
        calendarTooltip = document.getElementById('calendar-tooltip');
        monthlyView = document.getElementById('monthly-view');
        yearlyView = document.getElementById('yearly-view');
        verticalView = document.getElementById('vertical-view');
        viewMonthlyButton = document.getElementById('view-monthly-button');
        viewVerticalButton = document.getElementById('view-vertical-button');
        viewYearlyButton = document.getElementById('view-yearly-button');


        await fetchData();

        state.surveys.forEach(survey => {
            if (survey.status === 'assigned') {
                let currentDate = new Date(survey.startDate);
                const lastDate = new Date(survey.endDate);
                while (currentDate <= lastDate) {
                    const dateString = currentDate.toISOString().split('T')[0];
                    if (!state.assignmentOverrides[dateString]) {
                        state.assignmentOverrides[dateString] = { surveyIds: [] };
                    }
                    if (!state.assignmentOverrides[dateString].surveyIds.includes(survey.id)) {
                        state.assignmentOverrides[dateString].surveyIds.push(survey.id);
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }
        });

        renderAll();

        // --- Event Listeners ---
        viewMonthlyButton.addEventListener('click', () => switchView('monthly'));
        viewVerticalButton.addEventListener('click', () => switchView('vertical'));
        viewYearlyButton.addEventListener('click', () => switchView('yearly'));

        prevMonthButton.addEventListener('click', () => handleMonthChange(-1));
        nextMonthButton.addEventListener('click', () => handleMonthChange(1));
        
        settingPrevButton.addEventListener('click', () => {
            if (state.manualSettingsCurrentPage > 1) {
                state.manualSettingsCurrentPage--;
                renderManualSettings();
            }
        });
        settingNextButton.addEventListener('click', () => {
            const totalPages = Math.ceil(state.manualSettings.length / state.manualSettingsItemsPerPage);
            if (state.manualSettingsCurrentPage < totalPages) {
                state.manualSettingsCurrentPage++;
                renderManualSettings();
            }
        });

        logPrevButton.addEventListener('click', () => {
            if (state.logCurrentPage > 1) {
                state.logCurrentPage--;
                renderUpdateLog();
            }
        });
        logNextButton.addEventListener('click', () => {
            const totalPages = Math.ceil(state.updateLog.length / state.logItemsPerPage);
            if (state.logCurrentPage < totalPages) {
                state.logCurrentPage++;
                renderUpdateLog();
            }
        });

        calendarGrid.addEventListener('mousedown', handleDragStart);
        calendarGrid.addEventListener('mousemove', handleDrag);
        yearlyView.addEventListener('mousedown', handleDragStart);
        yearlyView.addEventListener('mousemove', handleDrag);
        verticalView.addEventListener('mousedown', handleDragStart);
        verticalView.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleDragEnd);

        let tooltipTimer = null;

        calendarGrid.addEventListener('mouseover', (e) => {
            if (state.isDragging) return;
            const cell = e.target.closest('[data-date]');

            if (!cell) {
                clearTimeout(tooltipTimer);
                calendarTooltip.style.display = 'none';
                return;
            }

            const isTooltipVisible = calendarTooltip.style.display === 'block';

            clearTimeout(tooltipTimer);

            const showTooltip = () => {
                const dateString = cell.dataset.date;
                const { status: dayStatus, reason: dayStatusReason } = getDayStatus(dateString, new Date(dateString).getDay());
                const surveysForDay = getSurveysForDay(dateString);
                const isAssigned = isDayAssigned(dateString);

                let tooltipHTML = `<div class="font-bold text-white mb-2">${dateString}</div>`;
                tooltipHTML += `<div><span class="font-semibold">ステータス:</span> ${dayStatus}${dayStatusReason ? ` (${dayStatusReason})` : ''}</div>`;
                tooltipHTML += `<div><span class="font-semibold">アンケート数:</span> ${surveysForDay.length}</div>`;
                if (isAssigned) {
                    tooltipHTML += `<div><span class="font-semibold">アサイン:</span> はい</div>`;
                }
                if (surveysForDay.length > 0) {
                    tooltipHTML += '<div class="mt-2 pt-2 border-t border-gray-500 font-semibold">アンケート:</div>';
                    tooltipHTML += '<ul class="list-disc pl-4">';
                    surveysForDay.forEach(s => {
                        tooltipHTML += `<li>${s.name} (${s.type})</li>`;
                    });
                    tooltipHTML += '</ul>';
                }

                calendarTooltip.innerHTML = tooltipHTML;
                calendarTooltip.style.display = 'block';
                calendarTooltip.style.left = `${e.pageX + 15}px`;
                calendarTooltip.style.top = `${e.pageY + 15}px`;
            };

            if (isTooltipVisible) {
                showTooltip();
            } else {
                tooltipTimer = setTimeout(showTooltip, 1000);
            }
        });

        calendarGrid.addEventListener('mousemove', (e) => {
            if (calendarTooltip.style.display === 'block') {
                calendarTooltip.style.left = `${e.pageX + 15}px`;
                calendarTooltip.style.top = `${e.pageY + 15}px`;
            }
        });

        calendarGrid.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimer);
            calendarTooltip.style.display = 'none';
        });


        document.getElementById('focus-area-close-tab').addEventListener('click', closeFocusArea);
        const closeButton = document.getElementById('focus-area-close-button');
        if (closeButton) {
            closeButton.addEventListener('click', closeFocusArea);
        }
        
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', () => setActiveTab(button.dataset.tab));
        });

        document.getElementById('focus-area').addEventListener('click', (e) => {
            const { currentFocusStartDate: startDate, currentFocusEndDate: endDate } = state;
            if (!startDate) return;

            const dateRange = [];
            forEachDateInRange(startDate, endDate || startDate, (dateString) => {
                dateRange.push(dateString);
            });
            const rangeString = endDate ? `${startDate}～${endDate}` : startDate;

            if (e.target.id === 'save-memo-button') {
                const memoText = document.getElementById('memo-textarea').value.trim();
                if (memoText) {
                    dateRange.forEach(date => { state.memos[date] = memoText; });
                    addLogEntry(`メモを更新しました: ${rangeString}`);
                } else if (!endDate) {
                    delete state.memos[startDate];
                    addLogEntry(`メモを削除しました: ${rangeString}`);
                }
                renderAll();
                closeFocusArea();
            }

            if (e.target.id === 'save-assignment-button') {
                const surveysInRange = getSurveysForRange(startDate, endDate || startDate);
                if (surveysInRange.length === 0) return;
                dateRange.forEach(date => {
                    const surveysForDay = getSurveysForDay(date);
                    if (surveysForDay.length > 0) {
                        if (!state.assignmentOverrides[date]) state.assignmentOverrides[date] = { surveyIds: [] };
                        surveysForDay.forEach(survey => {
                            if (!state.assignmentOverrides[date].surveyIds.includes(survey.id)) {
                                state.assignmentOverrides[date].surveyIds.push(survey.id);
                            }
                        });
                    }
                });
                const companyName = state.operators.length > 0 ? state.operators[0].company : 'N/A';
                addLogEntry(`${rangeString} を ${companyName} にアサインしました。`);
                renderAll();
                closeFocusArea();
            }

            if (e.target.id === 'cancel-assignment-button') {
                dateRange.forEach(date => { delete state.assignmentOverrides[date]; });
                const companyName = state.operators.length > 0 ? state.operators[0].company : 'N/A';
                addLogEntry(`${rangeString} の ${companyName} のアサインを解除しました。`);
                renderAll();
                closeFocusArea();
            }

            if (e.target.id === 'save-day-setting-button') {
                const eventType = document.querySelector('input[name="focus_event_type"]:checked').value;
                const reason = document.getElementById('focus-reason').value;
                if ((eventType === 'HOLIDAY' || eventType === 'SUBSTITUTE_WORKDAY') && !reason) {
                    alert('理由を入力してください。');
                    return;
                }
                dateRange.forEach(date => {
                    state.manualSettings = state.manualSettings.filter(s => s.event_date !== date);
                    if (eventType !== 'WORKDAY') {
                        state.manualSettings.push({
                            id: Date.now() + Math.random(),
                            event_date: date,
                            event_type: eventType,
                            reason: reason,
                            created_by: '現在のユーザー',
                            created_at: new Date().toISOString(),
                        });
                    }
                });
                if (eventType !== 'WORKDAY') addLogEntry(`${rangeString}を${eventType === 'HOLIDAY' ? '特別休業日' : '振替営業日'}に設定しました。`);
                else addLogEntry(`${rangeString}の個別設定を解除しました。`);
                renderAll();
                closeFocusArea();
            }
        });

        manualSettingsTableBody.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            
            const id = parseInt(button.dataset.id, 10);
            if (button.classList.contains('edit-setting-button')) {
                const setting = state.manualSettings.find(s => s.id === id);
                if(setting) openFocusArea(setting.event_date);
            }
            if (button.classList.contains('delete-setting-button')) {
                showDeleteConfirmModal(id);
            }
        });

        deleteConfirmModal.addEventListener('click', (e) => {
            if (e.target === deleteConfirmModal) closeDeleteConfirmModal();
        });
        cancelDeleteButton.addEventListener('click', closeDeleteConfirmModal);
        confirmDeleteButton.addEventListener('click', () => {
            if (state.settingToDeleteId) {
                state.manualSettings = state.manualSettings.filter(s => s.id !== state.settingToDeleteId);
                closeDeleteConfirmModal();
                renderAll();
            }
        });

        document.getElementById('export-csv-button').addEventListener('click', () => alert('CSVエクスポート機能は現在開発中です。'));
        document.getElementById('import-csv-button').addEventListener('click', () => alert('CSVインポート機能は現在開発中です。'));
                document.getElementById('sync-holidays-button').addEventListener('click', () => alert('祝日API同期を実行しました（シミュレーション）。'));
        
                window.addEventListener('wheel', (e) => {
                    const verticalView = document.getElementById('vertical-view');
                    // Only apply this logic if the vertical view is visible
                    if (!verticalView || verticalView.style.display === 'none') {
                        return;
                    }
        
                    // And if the event started inside the vertical view
                    if (!verticalView.contains(e.target)) {
                        return;
                    }
        
                    const { scrollTop, scrollHeight, clientHeight } = verticalView;
                    const atTop = scrollTop === 0;
                    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
        
                    // If at a boundary and scrolling "out", let the default window scroll happen.
                    if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
                        return;
                    }
        
                    // Otherwise, we are scrolling "inside" the div.
                    // Prevent the default window scroll, and manually scroll the div.
                    e.preventDefault();
                    verticalView.scrollTop += e.deltaY;
                }, { passive: false });
            }

    init();
}
