export default {
  async fetch(request) {
    return new Response("Hello from Cloudflare Workers!", {
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
};
