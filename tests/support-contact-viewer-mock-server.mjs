import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.SUPPORT_CONTACT_VIEWER_MOCK_PORT || 4178);
const htmlPath = '99_backend-docs/10_support-contact/viewer-gas/Index.html';
const fixturePath = 'tests/fixtures/support-contact-cs-cases.json';

function getOptions(fixtures) {
  return {
    statuses: ['未対応', '対応中', '顧客確認待ち', '引継ぎ待ち', '保留', '対応済み'],
    assignees: fixtures.allowedAssignees,
    urgencies: ['高', '中', '低'],
    categories: ['操作案内', '不具合', '契約・料金', '導入相談', '要望', 'その他'],
    handoffTargets: ['CS', '営業', '開発', '管理者', 'その他'],
    handoffStatuses: ['なし', '依頼済み', '受領済み', '差戻し'],
    resolutionCodes: ['解決', '案内完了', '引継ぎ完了', '対応不要', '継続対応'],
  };
}

function buildBrowserStub(fixtures) {
  const submission = fixtures.displaySubmission;
  const options = getOptions(fixtures);
  const listResponse = {
    ok: true,
    viewerEmail: '確認リンク',
    statuses: options.statuses,
    options,
    staleHours: 24,
    counts: {
      total: 1,
      active: 1,
      attention: 1,
      未対応: 0,
      対応中: 1,
      顧客確認待ち: 0,
      引継ぎ待ち: 0,
      保留: 0,
      対応済み: 0,
    },
    submissions: [submission],
  };
  const detailResponse = {
    ok: true,
    submission,
    events: fixtures.displayEvents,
    options,
    audit: {
      authMode: 'shared_token',
      actorIdentity: 'shared-token',
      accountAuditReliable: false,
    },
  };

  return `<script>
    (() => {
      const responses = ${JSON.stringify({ listResponse, detailResponse })};
      window.__CONTACT_MOCK_CALLS__ = [];
      const handlers = {
        validateViewerAccessToken: () => ({ allowed: true, email: '確認リンク', authMode: 'token', tokenConfigured: true }),
        listContactSubmissions: () => responses.listResponse,
        getContactSubmission: () => responses.detailResponse,
        updateContactCase: (_accessToken, submissionId, payload) => {
          window.__CONTACT_MOCK_CALLS__.push({ submissionId, payload });
          for (const key of Object.keys(responses.detailResponse.submission)) {
            if (Object.hasOwn(payload, key)) responses.detailResponse.submission[key] = payload[key];
          }
          return responses.detailResponse;
        },
        getAttachmentPreview: () => ({ ok: true, dataUrl: '', name: 'fixture.webp' }),
      };
      let successHandler = () => {};
      let failureHandler = () => {};
      const runnerTarget = {
        withSuccessHandler(handler) {
          successHandler = handler;
          return runner;
        },
        withFailureHandler(handler) {
          failureHandler = handler;
          return runner;
        },
      };
      const runner = new Proxy(runnerTarget, {
        get(target, property) {
          if (property in target) return target[property];
          return (...args) => Promise.resolve()
            .then(() => handlers[property](...args))
            .then(successHandler, failureHandler);
        },
      });
      window.google = {
        script: {
          run: runner,
          url: { getLocation: (callback) => callback({ parameter: { id: 'fixture-001' }, parameters: { id: ['fixture-001'] }, hash: '' }) },
          history: { replace: () => {} },
        },
      };
    })();
  </script>`;
}

async function buildHtml() {
  const [source, fixtureText] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(fixturePath, 'utf8'),
  ]);
  const fixtures = JSON.parse(fixtureText);
  return source
    .replace('<?!= JSON.stringify(initialSubmissionId) ?>', JSON.stringify('fixture-001'))
    .replace('<?!= JSON.stringify(initialAccessToken) ?>', JSON.stringify('mock-token'))
    .replace('<?!= JSON.stringify(viewerContext) ?>', JSON.stringify({ allowed: true, email: '確認リンク', authMode: 'token', tokenConfigured: true }))
    .replace('</head>', `${buildBrowserStub(fixtures)}</head>`);
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(await buildHtml());
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Support contact viewer mock: http://127.0.0.1:${port}/\n`);
});
