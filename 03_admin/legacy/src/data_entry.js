// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/data-entry/index.html と form.html(旧URL data_entry.html はリダイレクトのみ)。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

let performanceChartInstance = null; // Chart.js インスタンスを保持

// Chart.js インスタンスを保持するためのオブジェクト
let miniChartInstances = {};

// Function to draw a mini chart in the background of a KPI card
function drawMiniChart(canvasId, data, borderColor, chartLabel) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // 既存のチャートインスタンスがあれば破棄
    if (miniChartInstances[canvasId]) {
        miniChartInstances[canvasId].destroy();
    }

    miniChartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({ length: data.length }, (_, i) => `Day ${i + 1}`), // Dummy labels
            datasets: [{
                label: chartLabel,
                data: data,
                borderColor: borderColor,
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const { ctx, chartArea } = chart;
                    if (!chartArea) {
                        return null;
                    }
                    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                    // borderColor が "rgb(R, G, B)" 形式であることを想定し、rgba に変換
                    const rgbaColor0 = borderColor.replace('rgb', 'rgba').replace(')', ', 0)');   // rgba(R, G, B, 0)
                    const rgbaColor1 = borderColor.replace('rgb', 'rgba').replace(')', ', 0.5)'); // rgba(R, G, B, 0.5)
                    gradient.addColorStop(0, rgbaColor0);
                    gradient.addColorStop(1, rgbaColor1);
                    return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 0, // ポイントを非表示
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false
                },
                tooltip: {
                    enabled: false // ツールチップを非表示
                }
            },
            scales: {
                x: {
                    display: false, // X軸を非表示
                    grid: {
                        display: false
                    },
                    border: {
                        display: false
                    }
                },
                y: {
                    display: false, // Y軸を非表示
                    grid: {
                        display: false
                    },
                    border: {
                        display: false
                    }
                }
            },
            elements: {
                line: {
                    borderJoinStyle: 'round'
                }
            },
            layout: {
                padding: {
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0
                }
            },
            animation: {
                duration: 0 // アニメーションを無効化
            }
        }
    });
}

// Function to update KPI cards
function updateKPIs(summary) {
    const totalItems = summary.totalItems || 0;
    const completedItems = summary.completedItems || 0;

    // 総未完了数 = 総アイテム数 - 完了したアイテム数
    const totalUncompletedCount = totalItems - completedItems;
    // センター全体の完了数 = 完了したアイテム数
    const centerTotalCompletedCount = completedItems;
    // センター全体の整合率 = (完了したアイテム数 / 総アイテム数) * 100
    const centerConsistencyRate = totalItems > 0 ? ((completedItems / totalItems) * 100).toFixed(1) : 0;

    // 各カードに値を設定
    const totalUncompletedCountEl = document.getElementById('total-uncompleted-count');
    if (totalUncompletedCountEl) totalUncompletedCountEl.textContent = totalUncompletedCount.toLocaleString();

    const centerTotalCompletedCountEl = document.getElementById('center-total-completed-count');
    if (centerTotalCompletedCountEl) centerTotalCompletedCountEl.textContent = centerTotalCompletedCount.toLocaleString();

    const centerConsistencyRateEl = document.getElementById('center-consistency-rate');
    if (centerConsistencyRateEl) centerConsistencyRateEl.textContent = `${centerConsistencyRate}%`;

    // --- ミニグラフの描画 ---
    // ダミーのトレンドデータを生成 (過去7日間のデータ)
    const generateDummyTrendData = (baseValue, variance, isPercentage = false) => {
        const data = [];
        for (let i = 6; i >= 0; i--) { // 過去7日間
            let value = baseValue + (Math.random() - 0.5) * variance;
            if (isPercentage) value = Math.max(0, Math.min(100, value)); // 0-100%の範囲に制限
            data.push(isPercentage ? parseFloat(value.toFixed(1)) : Math.round(value));
        }
        return data.reverse(); // 最新が右に来るように反転
    };

    // 総未完了数のトレンド (減少傾向)
    const totalUncompletedTrend = generateDummyTrendData(totalUncompletedCount / 2, totalUncompletedCount / 4);
    drawMiniChart('total-uncompleted-chart', totalUncompletedTrend, 'rgb(239, 68, 68)', '総未完了数トレンド'); // Red

    // センター全体の完了数のトレンド (増加傾向)
    const centerCompletedTrend = generateDummyTrendData(centerTotalCompletedCount / 2, centerTotalCompletedCount / 4);
    drawMiniChart('center-total-completed-chart', centerCompletedTrend, 'rgb(59, 130, 246)', 'センター完了数トレンド'); // Blue

    // センター全体の整合率のトレンド (安定傾向)
    const centerConsistencyTrend = generateDummyTrendData(parseFloat(centerConsistencyRate), 5, true);
    drawMiniChart('center-consistency-chart', centerConsistencyTrend, 'rgb(168, 85, 247)', '整合率トレンド'); // Purple
}

// Function to render chart in modal
function renderPerformanceChart(type) {
    if (performanceChartInstance) {
        performanceChartInstance.destroy(); // 既存のグラフがあれば破棄
        performanceChartInstance = null; // インスタンスをリセット
    }
    const chartContainer = document.getElementById('myPerformanceChart').parentNode;
    chartContainer.innerHTML = '<canvas id="myPerformanceChart"></canvas>';
    const ctx = document.getElementById('myPerformanceChart').getContext('2d');

    let labels = [];
    let data = [];
    let title = '';
    let borderColor = '';

    // Summary data from the most recent fetch (assuming it's stored or accessible)
    // For this dummy, let's use fixed base values for calculation, or pass them from updateKPIs if available
    const baseTotalItems = 6520; // from data_entry_status.json
    const baseCompletedItems = 3580; // from data_entry_status.json

    // Dummy data for the last 7 days
    for (let i = 6; i >= 0; i--) { // 過去7日間を逆順に
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(`${d.getMonth() + 1}/${d.getDate()}`);

        // Base value for today (i=0) and then extrapolate backward
        if (type === 'uncompleted') {
            // 未完了数が徐々に減少するトレンド
            const uncompletedToday = baseTotalItems - baseCompletedItems;
            data.push(Math.max(0, uncompletedToday + (i * 50) + Math.floor(Math.random() * 20 - 10)));
            title = '過去7日間の総未完了数';
            borderColor = 'rgb(239, 68, 68)'; // Red
        } else if (type === 'completed') {
            // 完了数が徐々に増加するトレンド
            const completedToday = baseCompletedItems;
            data.push(Math.max(0, completedToday - (i * 100) + Math.floor(Math.random() * 50 - 25)));
            title = '過去7日間のセンター全体の完了数';
            borderColor = 'rgb(59, 130, 246)'; // Blue
        } else if (type === 'consistency') {
            // 整合率が高水準で推移するトレンド (90-100%)
            data.push(Math.max(90, Math.min(100, 95 + (Math.random() * 5 - 2.5))).toFixed(1)); // 90-100%
            title = '過去7日間のセンター全体の整合率';
            borderColor = 'rgb(168, 85, 247)'; // Purple
        }
    }
    data.reverse(); // 日付順に並べ替え

    performanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: data,
                borderColor: borderColor,
                tension: 0.3, // 少しカーブさせる
                fill: false,
                pointRadius: 3, // ポイントを表示
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: title
                }
            },
            scales: {
                y: {
                    beginAtZero: false
                }
            }
        }
    });
}

// Function to fetch data
async function fetchData() {
    try {
        const basePath = window.location.pathname.includes('/SPPED-AD-TEST/') ? '/SPPED-AD-TEST' : '';
        const response = await fetch(`${basePath}/data/admin/data_entry_status.json`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Could not fetch data:", error);
        // Display an error message on the page
        const mainContent = document.querySelector('main .max-w-6xl');
        if(mainContent) {
            mainContent.innerHTML = `
                <div class="bg-gray-800 p-6 rounded-lg text-center">
                    <h2 class="text-xl font-semibold text-red-400 mb-2">データの読み込みに失敗しました。</h2>
                    <p class="text-gray-400">時間をおいて再度お試しください。</p>
                    <button onclick="location.reload()" class="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">再試行</button>
                </div>`;
        }
        return null;
    }
}


// Function to render the task table
function renderTaskTable(tasks) {
    const tbody = document.getElementById('task-list-body');
    tbody.innerHTML = ''; // Clear existing rows

    if (tasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">表示対象のタスクはありません。</td></tr>';
        return;
    }

    const statuses = [
        { text: '未着手', color: 'text-gray-500 dark:text-gray-400' },
        { text: '作業中', color: 'text-blue-600 dark:text-blue-400' },
        { text: '保留', color: 'text-yellow-600 dark:text-yellow-400' },
        { text: '完了', color: 'text-green-600 dark:text-green-400' }
    ];

    tasks.forEach(task => {
        const progress = task.total > 0 ? (task.completed / task.total) * 100 : 0;
        const progressBarColorClass = progress === 100 ? 'bg-green-500 dark:bg-green-600' : 'bg-blue-500 dark:bg-blue-600';
        
        // Select a random status for mock purposes
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
        const statusText = randomStatus.text;
        const statusColorClass = randomStatus.color;

        const row = document.createElement('tr');
        row.className = 'hover:bg-surface-variant cursor-pointer';
        row.onclick = () => {
            if (task.id === 'admin') {
                window.location.href = `sample/data_entry_admin_form.html`;
            } else {
                window.location.href = `BY-211_オペレーター入力画面/BY-213/BY-213.html?groupId=${task.id}`;
            }
        };

        let buttonHtml = '';
        if (task.completed < task.total || task.id === 'admin') {
            const destination = task.id === 'admin'
                ? 'sample/data_entry_admin_form.html'
                : `BY-211_オペレーター入力画面/BY-213/BY-213.html?groupId=${task.id}`;
            buttonHtml = `<button class="bg-blue-500 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-xs" onclick="event.stopPropagation(); window.location.href = '${destination}'">作業開始</button>`;
        }

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-on-surface">${task.name}</div>
                <div class="text-xs ${statusColorClass} mt-1">${statusText}</div>
                <div class="text-xs text-on-surface-variant">${task.description}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center justify-center">
                    <div class="w-24 bg-surface-variant rounded-full h-2.5 mr-3">
                        <div class="${progressBarColorClass} h-2.5 rounded-full" style="width: ${progress}%"></div>
                    </div>
                    <span class="text-sm text-on-surface-variant">${Math.round(progress)}%</span>
                </div>
                <div class="text-xs text-on-surface-variant text-center">${task.completed.toLocaleString()} / ${task.total.toLocaleString()} 件</div>
            </td>
            <td class="py-4 pl-6 pr-0 whitespace-nowrap text-sm text-on-surface-variant">${new Date(task.lastUpdatedAt).toLocaleString('ja-JP')}</td>
            <td class="py-4 pl-2 pr-6 whitespace-nowrap text-left">
                ${buttonHtml}
            </td>
        `;
        tbody.appendChild(row);
    });
}

export async function initDataEntryPage() {
    const data = await fetchData();
    if (!data) return; // Stop if data fetch failed

    updateKPIs(data.summary);
    renderTaskTable(data.tasks);

    // Event listeners for personal performance cards to open modal
    document.getElementById('total-uncompleted-count').closest('.kpi-card').addEventListener('click', () => {
        document.getElementById('graphModalTitle').textContent = '総未完了数 詳細';
        document.getElementById('graphModal').classList.remove('hidden');
        renderPerformanceChart('uncompleted'); // 新しいチャートタイプ
    });

    document.getElementById('center-total-completed-count').closest('.kpi-card').addEventListener('click', () => {
        document.getElementById('graphModalTitle').textContent = 'センター全体の完了数 詳細';
        document.getElementById('graphModal').classList.remove('hidden');
        renderPerformanceChart('completed');
    });

    document.getElementById('kpi-consistency-card').addEventListener('click', () => {
        document.getElementById('graphModalTitle').textContent = 'センター全体の整合率 詳細';
        document.getElementById('graphModal').classList.remove('hidden');
        renderPerformanceChart('consistency');
    });

    // Event listeners to close modal
    document.getElementById('closeGraphModal').addEventListener('click', () => {
        document.getElementById('graphModal').classList.add('hidden');
    });
    document.getElementById('modalCloseBtn').addEventListener('click', () => {
        document.getElementById('graphModal').classList.add('hidden');
    });

    // Close modal when clicking outside of it
    document.getElementById('graphModal').addEventListener('click', (event) => {
        if (event.target.id === 'graphModal') {
            document.getElementById('graphModal').classList.add('hidden');
        }
    });

    // TODO: Add event listeners for KPI cards and chart period selector
}
