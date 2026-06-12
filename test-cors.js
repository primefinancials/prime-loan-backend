const cors = require('cors');
const express = require('express');
const app = express();
const crossOrigin = require('./dist/shared/utils/cross-origin').default;
app.use(crossOrigin());
app.get('/', (req, res) => res.send('ok'));
app.listen(3002, () => {
    console.log('Test server running');
    process.exit(0);
});
