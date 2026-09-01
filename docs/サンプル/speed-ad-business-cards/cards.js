const profile = {
  company: 'アブロードアウトソーシング株式会社',
  division: 'SPEED AD事業部',
  role: 'プロダクトセールス',
  name: '山田 太郎',
  nameEn: 'TARO YAMADA',
  phone: '03-0000-0000',
  email: 'sample@speed-ad.com',
  web: 'speed-ad.com'
};

const concepts = [
  ['signal-white', 'Signal White', '余白とブランド色で信頼感を出す王道'],
  ['navy-frame', 'Navy Frame', '細いネイビー枠で情報を端正に整理'],
  ['slate-minimal', 'Slate Minimal', 'グレーを効かせた静かなミニマル'],
  ['vertical-mark', 'Vertical Mark', '縦方向のブランド帯で視線を誘導'],
  ['quiet-grid', 'Quiet Grid', '小さなグリッドでデータ感を表現'],
  ['azure-mesh', 'Azure Mesh', '青のメッシュでクラウド感を演出'],
  ['circuit-line', 'Circuit Line', '接続線でデータ連携を表現'],
  ['data-dots', 'Data Dots', 'ドットの集合で情報の集約を表現'],
  ['scan-window', 'Scan Window', 'OCRの読み取り窓をモチーフ化'],
  ['interface-panel', 'Interface Panel', '管理画面のパネル構造を抽象化'],
  ['velocity-slash', 'Velocity Slash', '斜線でサービス名のスピードを強調'],
  ['motion-track', 'Motion Track', '連続する軌道でフォローの速さを表現'],
  ['yellow-burst', 'Yellow Burst', 'ブランドイエローを大胆に使用'],
  ['aero-stripe', 'Aero Stripe', '細い流線で軽快な推進力を演出'],
  ['fast-lane', 'Fast Lane', '複数レーンで一連の業務フローを表現'],
  ['qr-hero', 'QR Hero', 'QRを主役にした展示会向けの構成'],
  ['full-scan', 'Full Scan', '裏面を大きなスキャン導線として設計'],
  ['event-pass', 'Event Pass', '展示会パスのような実務的レイアウト'],
  ['feature-tiles', 'Feature Tiles', '3つの基本機能をタイルで可視化'],
  ['follow-up', 'Follow-up Flow', '準備から追客までの4ステップを表示'],
  ['black-gold', 'Black & Gold', '黒とブランドイエローの上質な対比'],
  ['midnight-foil', 'Midnight Foil', '深いネイビーに光沢線を想定'],
  ['executive-navy', 'Executive Navy', '役員・商談用途を意識した重厚感'],
  ['soft-ivory', 'Soft Ivory', '温度感のあるアイボリーで親しみを演出'],
  ['monochrome', 'Monochrome', '特色1色でも成立する印刷向け案'],
  ['cyber-grid', 'Cyber Grid', 'サイバーグリッドで未来感を強調'],
  ['neon-signal', 'Neon Signal', 'ネオンの信号線で瞬発力を表現'],
  ['glass-layer', 'Glass Layer', '半透明レイヤーで情報の重なりを表現'],
  ['pixel-pulse', 'Pixel Pulse', 'ピクセルの脈動でリアルタイム性を表現'],
  ['future-portal', 'Future Portal', 'データの入口をポータル形状で表現']
];

const logo = (light = false) => `
  <img class="brand-logo ${light ? 'brand-logo--light' : ''}" src="speedad-logo.svg" alt="SPEED AD">
`;

const contactBlock = () => `
  <div class="identity">
    <p class="division">${profile.division} / ${profile.role}</p>
    <p class="person-name">${profile.name}</p>
    <p class="person-name-en">${profile.nameEn}</p>
  </div>
  <dl class="contact-list">
    <div><dt>T</dt><dd>${profile.phone}</dd></div>
    <div><dt>E</dt><dd>${profile.email}</dd></div>
    <div><dt>W</dt><dd>${profile.web}</dd></div>
  </dl>
  <p class="company-name">${profile.company}</p>
`;

const qrBlock = (label = 'サービスサイトを見る') => `
  <div class="qr-block">
    <img src="qr-speed-ad.png" alt="SPEED AD公式サイトのQRコード">
    <p>${label}</p>
  </div>
`;

const standardBack = () => `
  <div class="back-copy">
    <p class="back-kicker">EXHIBITION LEAD EXPERIENCE</p>
    <h3>スピードを<br>アドバンテージに。</h3>
    <p>展示会やイベントのリード獲得・フォローを最適化。</p>
  </div>
  ${qrBlock()}
`;

const featureBack = () => `
  <div class="feature-heading">
    ${logo()}
    <p>展示会の準備から追客まで、ひとつの流れで。</p>
  </div>
  <ul class="feature-list">
    <li><span>01</span>WEBアンケート</li>
    <li><span>02</span>名刺情報のデータ化</li>
    <li><span>03</span>御礼メール</li>
  </ul>
  ${qrBlock('詳しく見る')}
`;

const flowBack = () => `
  <div class="flow-heading">
    <p class="back-kicker">SPEED AD FLOW</p>
    <h3>獲得したリードを、次のアクションへ。</h3>
  </div>
  <ol class="flow-list">
    <li><span>01</span>準備</li>
    <li><span>02</span>QR回答</li>
    <li><span>03</span>名刺撮影</li>
    <li><span>04</span>追客</li>
  </ol>
  ${qrBlock('サービスサイト')}
`;

const scanBack = () => `
  <div class="scan-copy">
    <p>SCAN TO EXPERIENCE</p>
    <h3>SPEED AD</h3>
    <span>展示会のリード獲得・フォローを最適化</span>
  </div>
  ${qrBlock('speed-ad.com')}
`;

const frontMarkup = (index) => `
  <div class="decor decor-a"></div>
  <div class="decor decor-b"></div>
  <div class="front-brand">${logo(index >= 20 && [20, 21, 22, 25, 26, 28, 29].includes(index))}</div>
  ${contactBlock()}
  <span class="sample-note">SAMPLE INFORMATION</span>
`;

const backMarkup = (index) => {
  if ([15, 16, 17, 25, 26, 27, 28, 29].includes(index)) {
    return `<div class="decor decor-a"></div><div class="decor decor-b"></div>${scanBack()}`;
  }
  if ([8, 9, 18].includes(index)) {
    return `<div class="decor decor-a"></div><div class="decor decor-b"></div>${featureBack()}`;
  }
  if ([10, 11, 12, 13, 14, 19].includes(index)) {
    return `<div class="decor decor-a"></div><div class="decor decor-b"></div>${flowBack()}`;
  }
  return `<div class="decor decor-a"></div><div class="decor decor-b"></div>${standardBack()}`;
};

const gallery = document.querySelector('#card-gallery');
const template = document.querySelector('#card-set-template');

concepts.forEach(([slug, title, description], index) => {
  const fragment = template.content.cloneNode(true);
  const section = fragment.querySelector('.card-set');
  const front = fragment.querySelector('.card-front');
  const back = fragment.querySelector('.card-back');

  section.dataset.concept = slug;
  section.style.setProperty('--set-index', index + 1);
  fragment.querySelector('.set-number').textContent = String(index + 1).padStart(2, '0');
  fragment.querySelector('.set-title').textContent = title;
  fragment.querySelector('.set-description').textContent = description;
  front.innerHTML = frontMarkup(index);
  back.innerHTML = backMarkup(index);
  gallery.append(fragment);
});
