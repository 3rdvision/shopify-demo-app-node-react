require('isomorphic-fetch');
const dotenv = require('dotenv');
dotenv.config();
const Koa = require('koa');
const next = require('next');
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth');
const { verifyRequest } = require('@shopify/koa-shopify-auth');
const session = require('koa-session');
const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy');
const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy');
const Router = require('koa-router');
const { receiveWebhook, registerWebhook } = require('@shopify/koa-shopify-webhooks');
const getSubscriptionUrl = require('./server/getSubscriptionUrl');
const ripeShopifyApi = require('ripe-shopify-api');

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const bodyParser = require('koa-bodyparser');

const {
  SHOPIFY_API_SECRET_KEY,
  SHOPIFY_API_KEY,
  HOST,
} = process.env;

app.prepare().then(() => {
  const server = new Koa();
  const router = new Router();
  server.use(session({ sameSite: 'none', secure: true }, server));
  server.keys = [SHOPIFY_API_SECRET_KEY];

  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      scopes: ['read_products', 'write_products'],
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set("shopOrigin", shop, {
          httpOnly: false,
          secure: true,
          sameSite: 'none'
        });
        ctx.cookies.set("shopOriginAccessToken", accessToken, {
          httpOnly: false,
          secure: true,
          sameSite: 'none'
        });

        const registration = await registerWebhook({
          address: `${HOST}/webhooks/products/create`,
          topic: 'PRODUCTS_CREATE',
          accessToken,
          shop,
          apiVersion: ApiVersion.October19
        });

        if (registration.success) {
          console.log('Successfully registered webhook!');
        } else {
          console.log('Failed to register webhook', registration.result);
        }
        await getSubscriptionUrl(ctx, accessToken, shop);
      }
    })
  );

  const webhook = receiveWebhook({ secret: SHOPIFY_API_SECRET_KEY });

  router.post('/webhooks/products/create', webhook, (ctx) => {
    console.log('received webhook: ', ctx.state.webhook);
  });

  server.use(graphQLProxy({ version: ApiVersion.April19 }));

  router.get('/API', async ctx => {
    console.log("Super duper /API");
    const token = ctx.request.header.token;
    const api = new ripeShopifyApi.API({ store: "platforme-alpha-test", token: token });
    console.info((await api.listProducts()).data.products.edges[0].node.featuredImage);

    fetch(`https://platforme-alpha-test.myshopify.com/admin/api/2019-07/products/count.json`, {
    headers: {
        'Content-Type': 'application/json',
        "X-Shopify-Access-Token": "713213e70c38af97183077f78ee73648",
    }
    }).then((response) => {
        return response.json();
    }).then((data) => {
        console.log(data);
    }).catch((err) => {
        console.error("DAMN IT CORS!", err);
    })
  });

  router.put('/API', async ctx => {
    console.log("Super duper POST on /API");
    console.log("ctx.request.body", ctx.request.body);

    const token = ctx.request.header.token;
    console.log("token", token);
    const api = new ripeShopifyApi.API({ store: "platforme-alpha-test", token: token });

    const metafield = {
        metafield: {
            namespace: "platforme",
            key: "query",
            value: "?brand=sergio_rossi&model=sr1_running&p=sole:rubber_sr:black&p=front:royal_sr:black&p=back:royal_sr:black&p=tongue:royal_sr:black&p=side:technical_fabric_sr:black&p=loop:grosgrain_sr:black&p=plate:metal_sr:gold24&p=shadow:default:default",
            description: "The RIPE Shopify API",
            value_type: "string"
        }
    };

    console.info((await api.upsertProductMetafield( "4739696885898", metafield)));
  });

  router.get('*', verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });

  server.use(bodyParser());
  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
