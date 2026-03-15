import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  // Use './' so all asset paths are relative — required for GitHub Pages
  base: './',
  build: {
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        amazonStore: resolve(__dirname, 'amazon-store/index.html'),
        admin:       resolve(__dirname, 'admin/index.html')
      },
    },
  },
  plugins: [
    {
      name: 'local-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/save-local' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const data = JSON.parse(body);
                const { product, imageBase64, imageName } = data;

                // 1. Save Image
                const imagesDir = resolve(__dirname, 'public/images/products');
                if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

                const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
                const imagePath = path.join(imagesDir, imageName);
                fs.writeFileSync(imagePath, base64Data, 'base64');
                
                const relativeImagePath = `/images/products/${imageName}`;

                // 2. Update JSON
                const jsonPath = resolve(__dirname, 'public/data/amazon-products.json');
                const productsJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                
                const newProduct = {
                  ...product,
                  id: productsJson.products.length + 1,
                  image: relativeImagePath
                };
                
                productsJson.products.unshift(newProduct);
                fs.writeFileSync(jsonPath, JSON.stringify(productsJson, null, 2));

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, imagePath: relativeImagePath, product: newProduct }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else {
            next();
          }
        });
      }
    }
  ]
});

