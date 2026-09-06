const headers = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

export default {
  fetch() {
    return new Response(JSON.stringify({ error: 'trial_disabled' }), {
      status: 503,
      headers,
    });
  },
};
