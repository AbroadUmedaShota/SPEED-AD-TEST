// 【未参照】この実装は現行画面から読み込まれていない(2026-08-06 時点)。
// 現行は 03_admin/coupon-management.html の inline script(一括作成ウィザード #mBulkCoupon)。
// docs/画面設計/仕様/18_screen_inventory_current.md ほかが棚卸し対象として参照しているため残置する。

// Simplified for debugging

export async function initCouponBulkCreate() {
    const placeholder = document.getElementById('bulkCreateCouponModalPlaceholder');
    if (!placeholder) return;

    try {
        const modalUrl = new URL('../modals/bulkCreateCouponModal.html', import.meta.url);
        const response = await fetch(modalUrl);
        if (!response.ok) throw new Error('Failed to load modal');
        placeholder.innerHTML = await response.text();
        
        const bulkCreateModal = document.getElementById('bulk-create-coupon-modal');
        const openBtn = document.getElementById('bulkCreateCouponButton');
        const closeBtn = bulkCreateModal.querySelector('[data-action="close"]');

        if (openBtn) {
            openBtn.addEventListener('click', () => {
                bulkCreateModal.dataset.state = 'open';
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                bulkCreateModal.dataset.state = 'closed';
            });
        }
        console.log('Bulk create modal initialized successfully.');

    } catch (error) {
        console.error('Error in initCouponBulkCreate:', error);
    }
}
