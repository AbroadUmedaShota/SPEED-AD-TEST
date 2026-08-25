document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const invoiceId = urlParams.get('invoiceId');

    const loadingOverlay = document.getElementById('invoice-detail-loading-overlay');
    const messageOverlay = document.getElementById('invoice-detail-message-overlay');
    const mainContent = document.getElementById('main-content'); // メインコンテンツエリア

    async function fetchInvoiceDetails() {
        loadingOverlay.classList.remove('hidden');
        messageOverlay.classList.add('hidden');
        mainContent.classList.add('hidden'); // メインコンテンツを一時的に非表示にする

        try {
            const response = await fetch('data/invoices.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const invoices = await response.json();
            const invoice = invoices.find(inv => inv.invoiceId === invoiceId);

            if (invoice) {
                renderInvoice(invoice);
                mainContent.classList.remove('hidden');
            } else {
                showMessage('指定された請求書が見つかりませんでした。');
            }
        } catch (error) {
            console.error('請求書データの読み込みに失敗しました:', error);
            showMessage('請求書データの読み込みに失敗しました。再試行してください。');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }

    function renderInvoice(invoice) {
        // 請求書情報エリア
        document.getElementById('invoice-number').textContent = invoice.invoiceId;
        document.getElementById('issue-date').textContent = invoice.issueDate;
        document.getElementById('due-date').textContent = invoice.dueDate;
        document.getElementById('corporate-name').textContent = invoice.corporateName + ' 御中';
        document.getElementById('contact-person').textContent = invoice.contactPerson + ' 様';

        // 請求明細テーブル
        const itemsBody = document.getElementById('invoice-items-table-body');
        itemsBody.innerHTML = ''; // 既存の行をクリア
        invoice.items.forEach((item, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap">${index + 1}</td>
                <td class="px-4 py-3 whitespace-nowrap">${item.itemName1 || ''}</td>
                <td class="px-4 py-3 whitespace-nowrap">${item.itemName2 || ''}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right">${item.quantity !== undefined ? item.quantity.toLocaleString() : ''}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right">${item.unitPrice !== undefined ? item.unitPrice.toLocaleString() : ''}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right">¥${item.amount.toLocaleString()}</td>
            `;
            itemsBody.appendChild(row);
        });

        // 合計金額
        document.getElementById('subtotal-taxable').textContent = `¥${invoice.subtotalTaxable.toLocaleString()}`;
        document.getElementById('tax-amount').textContent = `¥${invoice.tax.toLocaleString()}`;
        document.getElementById('subtotal-non-taxable').textContent = `¥${invoice.subtotalNonTaxable.toLocaleString()}`;
        document.getElementById('total-amount').textContent = `¥${invoice.totalAmount.toLocaleString()}`;

        // 振込先情報エリア (仮データ)
        document.getElementById('bank-name').textContent = 'サンプル銀行(0000)';
        document.getElementById('branch-name').textContent = '本店(001)';
        document.getElementById('account-type').textContent = '普通';
        document.getElementById('account-number').textContent = '1234567';
        document.getElementById('account-holder').textContent = 'アブロードアウトソーシング株式会社';
    }

    function showMessage(msg) {
        messageOverlay.classList.remove('hidden');
        messageOverlay.querySelector('p').textContent = msg;
        mainContent.classList.add('hidden'); // メインコンテンツを非表示にする
    }

    // 印刷ボタンのイベントリスナー
    const printInvoiceBtn = document.getElementById('printInvoiceBtn');
    if (printInvoiceBtn) {
        printInvoiceBtn.addEventListener('click', () => {
            if (invoiceId) {
                window.open(`invoice-print.html?invoiceId=${invoiceId}`, '_blank');
            } else {
                console.warn('請求書IDが取得できないため、印刷できません。');
            }
        });
    }

    // 請求書データを読み込む
    if (invoiceId) {
        fetchInvoiceDetails();
    } else {
        showMessage('請求書IDが指定されていません。');
    }
});