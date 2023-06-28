const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const Moment = require('moment');

const app = express();
const url = `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}fastners.e3aqj.mongodb.net/bills?retryWrites=true&w=majority`;
mongoose.connect(url, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log("Connected to DB!!!!");
}).catch((err) => {
    console.log("ERROR:", err.message);
});

const clientsSchema = new mongoose.Schema({
    name: { type: String, required: true },
    address: { type: String, required: true },
    mobile: { type: String, required: true },
    gstNumber: { type: String, required: true },
    placeOfSupply: { type: String, required: true }
});
const clients = mongoose.model(
    "clients",
    clientsSchema
);

const billsSchema = new mongoose.Schema({
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'clients' },
    invoiceNumber: { type: String },
    products: { type: Array },
    totalQuantity: { type: Number },
    totalAmount: { type: Number },
    totalNetAmount: { type: Number },
    totalTaxAmount: { type: Number },
    createdOn: { type: Date },
}, { timestamps: true });

const bills = mongoose.model(
    "bills",
    billsSchema
);

const countersSchema = new mongoose.Schema({
    tableName: { type: String },
    sequence_value: { type: Number }
});

const counters = mongoose.model(
    "counters",
    countersSchema
);

const getNextSequenceValue = async (sequenceName) => {
    var sequenceDocument = await counters.findOne({ tableName: sequenceName });
    const currentValue = sequenceDocument.sequence_value;
    sequenceDocument.sequence_value = currentValue + 1;
    await sequenceDocument.save()
    return currentValue + 1;
}

app.use(require('express-status-monitor')());

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));
app.set('view engine','ejs');

app.get('/', async (req, res) => {
    const clientsList = await clients.find({});
    res.render('home', { clientsList });
});

app.post('/bill/add', async (req, res) => {
    const names = req.body.name;
    const rates = req.body.rate;
    const amounts = req.body.amount;
    const hsns = req.body.hsn;
    const client = req.body.clientId;
    const createdOn = req.body.date ? new Date(req.body.date) : new Date();
    const products = [];
    let totalAmount = 0.00, totalNetAmount = 0.00, totalQuantity = 0.00, totalTaxAmount = 0.00;
    for(let i=0; i<names.length; i++){
        const productObject = {name: names[i], hsn: hsns[i]};
        const netAmount = parseFloat(amounts[i]);
        const amountWithoutGst = (netAmount/103)*100;
        const rate = parseFloat(rates[i]);
        productObject.quantity = amountWithoutGst/rate;
        totalQuantity += productObject.quantity;
        productObject.rate = rate;
        productObject.amount = amountWithoutGst;
        totalAmount += productObject.amount;
        productObject.tax = 'IGST 3%';
        productObject.taxAmount = (netAmount - amountWithoutGst);
        totalTaxAmount += productObject.taxAmount;
        productObject.netAmount = netAmount;
        totalNetAmount += productObject.netAmount;
        productObject.amount = productObject.amount.toFixed(2);
        productObject.taxAmount = productObject.taxAmount.toFixed(2);
        productObject.rate = productObject.rate.toFixed(2);
        productObject.netAmount = productObject.netAmount.toFixed(2);
        productObject.quantity = productObject.quantity.toFixed(3);
        products.push(productObject);
    }
    totalAmount = totalAmount.toFixed(2);
    totalNetAmount = totalNetAmount.toFixed(2);
    totalQuantity = totalQuantity.toFixed(3);
    totalTaxAmount = totalTaxAmount.toFixed(2);
    const currentCounter = await getNextSequenceValue('billCount');
    const currentYearString = new Date().getFullYear().toString().substr(2, 4);
    const nextYear = parseInt(currentYearString) + 1;
    const invoiceNumber = `GSTT/${currentYearString}-${nextYear}/${currentCounter}`;
    await bills.create({ products, client, totalAmount, totalNetAmount, totalQuantity, totalTaxAmount, invoiceNumber, createdOn });
    res.redirect('/');
})

app.get('/bills', async (req, res) => {
    const billsList = await bills.find({}).populate('client');
    res.render('bills', { billsList });
})

app.post('/download/:billId', async (req, res) => {
    const billData = await bills.findById(req.params.billId);
    const client = await clients.findById(billData.client);
    var fs = require("fs");
    var pdf = require("html-pdf");
    var ejs = require("ejs");
    var content = fs.readFileSync("./views/download.ejs", "utf8");
    content = ejs.render(content, { billData, client });
    const { createGzip } = require("zlib");
    var filename = "test.pdf";
    res.writeHead(200, {
        "Content-Type": "application/pdf; charset=utf-8",
        "Content-Disposition": "attachment; filename=" + filename + "",
        "Content-Encoding": "gzip",
    });

    pdf.create(content, {
        height: "21.60in",
        width: "14.60in",
        border: { top: "0.5in" },
        paginationOffset: 1,
        footer: {
            contents: {
              default: '<div style="color: #444; margin-left : 500px; font-weight: bold">{{page}}</div>',
            },
        },
    }).toStream((err, stream) => {
        if (err) {
            console.log(err);
            return res.sendStatus(500);
        } else {
            stream.pipe(createGzip()).pipe(res);
        }
    });
});

app.get('/bill/edit/:billId', async (req, res) => {
    const billAsync = bills.findById(req.params.billId);
    const bill = (await billAsync)._doc;
    const clientsListAsync = clients.find();
    const clientAsync = clients.findById(bill.client);
    const clientsList = await clientsListAsync;
    const client = await clientAsync;
    res.render('editBill', { bill: { ...bill, createdOn: Moment(bill.createdOn).format('YYYY-MM-DD') }, clientsList, client });
});

app.post('/bill/edit/:billId', async (req, res) => {
    const bill = await bills.findById(req.params.billId);
    const names = req.body.name;
    const rates = req.body.rate;
    const amounts = req.body.amount;
    const hsns = req.body.hsn;
    const client = req.body.clientId;
    const createdOn = req.body.date ? new Date(req.body.date) : new Date();
    const products = [];
    let totalAmount = 0.00, totalNetAmount = 0.00, totalQuantity = 0.00, totalTaxAmount = 0.00;
    for(let i=0; i<names.length; i++){
        const productObject = {name: names[i], hsn: hsns[i]};
        const netAmount = parseFloat(amounts[i]);
        const amountWithoutGst = (netAmount/103)*100;
        const rate = parseFloat(rates[i]);
        productObject.quantity = amountWithoutGst/rate;
        totalQuantity += productObject.quantity;
        productObject.rate = rate;
        productObject.amount = amountWithoutGst;
        totalAmount += productObject.amount;
        productObject.tax = 'IGST 3%';
        productObject.taxAmount = (netAmount - amountWithoutGst);
        totalTaxAmount += productObject.taxAmount;
        productObject.netAmount = netAmount;
        totalNetAmount += productObject.netAmount;
        productObject.amount = productObject.amount.toFixed(2);
        productObject.taxAmount = productObject.taxAmount.toFixed(2);
        productObject.rate = productObject.rate.toFixed(2);
        productObject.netAmount = productObject.netAmount.toFixed(2);
        productObject.quantity = productObject.quantity.toFixed(3);
        products.push(productObject);
    }
    totalAmount = totalAmount.toFixed(2);
    totalNetAmount = totalNetAmount.toFixed(2);
    totalQuantity = totalQuantity.toFixed(3);
    totalTaxAmount = totalTaxAmount.toFixed(2);
    const currentCounter = await getNextSequenceValue('billCount');
    const currentYearString = new Date().getFullYear().toString().substr(2, 4);
    const nextYear = parseInt(currentYearString) + 1;
    const invoiceNumber = `GSTT/${currentYearString}-${nextYear}/${currentCounter}`;
    bill.products = products;
    bill.client = client;
    bill.totalAmount = totalAmount;
    bill.totalNetAmount = totalNetAmount;
    bill.totalQuantity = totalQuantity;
    bill.totalTaxAmount = totalTaxAmount;
    bill.createdOn = createdOn;
    await bill.save();
    res.redirect('/bills');
});

app.get('/clients', async (req, res) => {
    const clientsList = await clients.find({});
    res.render('clients', { clientsList })
});

app.get('/client/add', (req, res) => {
    res.render('addClient');
});

app.post('/client/add', async (req, res) => {
    const { name, address, mobile, gstNumber, placeOfSupply } = req.body;
    await clients.create({ name, address, mobile, gstNumber, placeOfSupply });
    res.redirect("/");
});

app.get('/client/edit/:clientId', async(req, res) => {
    const client = await clients.findById(req.params.clientId);
    res.render('editClient', { client });
});

app.post('/client/edit/:clientId', async (req, res) => {
    const { name, address, mobile, gstNumber, placeOfSupply } = req.body;
    await clients.findByIdAndUpdate(req.params.clientId, { name, address, mobile, gstNumber, placeOfSupply });
    res.redirect("/clients");
});

app.post('/client/delete/:clientId', async (req, res) => {
    await clients.findByIdAndDelete(req.params.clientId);
    res.redirect('/clients');
});

app.listen(process.env.PORT || 3000, (req, res) => {
    console.log('Server has Started');
});
