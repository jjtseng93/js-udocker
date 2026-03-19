const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function(app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://backend:"+(process.env.BACKEND_PORT||2080),
      pathRewrite: { "^/api": "" }
    })
  );
};
