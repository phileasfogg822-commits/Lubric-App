# White-Label Business Billing, Inventory, Accounting & Order Management App
## Master Product Requirements & Build Specification

**Working product name:** BusinessOS  
**Target:** Android-first, white-label, offline-first business management platform  
**Primary inspiration:** Vyapar-style workflows, rebuilt with stronger white-label architecture, configurable modules, country-independent tax support, and field-sales/order-taking capabilities.

---

# 1. Product Purpose

The application should be an Android-first business-management platform for:

- Billing
- Invoicing
- Inventory
- Accounting
- Sales orders
- Purchase orders
- Quotations
- Delivery challans
- Payments
- Expenses
- Other income
- Customer and supplier ledgers
- Multiple users
- Multiple devices
- Multiple branches
- Multiple warehouses
- POS/counter sales
- Field-sales order taking
- Reports
- Backup
- Sync
- Notifications
- White-label deployment

The product must not be hard-coded for one industry, company, country, currency, tax regime, business type, or brand.

The same codebase should be able to become:

- Lubricant distributor app
- Pharmacy billing app
- Grocery POS
- Auto-parts distributor
- Wholesale business app
- Retail sales app
- Electronics inventory app
- Service business app
- Dealer-ordering app
- Field-sales app
- General accounting app

---

# 2. Core Architectural Rule

Do **not** build the product as:

```text
Business App
→ Fixed Screens
→ Fixed Functions
```

Build it as:

```text
Platform Core
→ Tenant / Business
→ Configuration Engine
→ Enabled Modules
→ Feature Flags
→ Theme / Branding
→ Permissions
→ Business Data
```

The application should be configuration-driven.

---

# 3. White-Label System

A super-admin or deployment configuration must control:

## 3.1 Branding

- App name
- Product name
- Company name
- Short name
- Android launcher name
- App logo
- Launcher icon
- Adaptive icon
- Splash-screen logo
- Splash-screen background
- Primary color
- Secondary color
- Accent color
- Success color
- Warning color
- Error color
- Navigation-bar appearance
- Light/dark mode
- Font family
- Card style
- Button style
- Border radius
- Login-screen branding
- Support contact details
- Terms URL
- Privacy URL
- Website

## 3.2 Deployment-Level White Label

Configurable per build:

```text
Application Name
Application ID / Package Name
Version Name
Version Code
App Icon
Splash Screen
Firebase Project
API Endpoint
Database Environment
Payment Gateway
Support Email
Support Phone
Privacy URL
Terms URL
Website
```

Example:

```text
Brand:
Zafar Lubricants

Package:
com.zafarlubricants.business

Primary Color:
#C49834

Invoice Title:
Sales Invoice
```

Another deployment from the same source:

```text
Brand:
ABC Pharmacy

Package:
com.abcpharmacy.pos

Primary Color:
#117A65

Invoice Title:
Retail Invoice
```

---

# 4. Two Levels of Customization

## Level A — Deployment Configuration

Controlled by the developer/platform owner.

Includes:

- App name
- App icon
- Splash screen
- Package ID
- API endpoint
- License system
- Included modules
- Default branding
- Firebase project
- Store configuration

## Level B — Customer Configuration

Controlled by the business owner inside the app.

Includes:

- Company logo
- Company details
- Invoice theme
- Invoice colors
- Terminology
- Tax
- Currency
- Payment modes
- Modules
- Inventory settings
- Printing
- Users
- Notifications

---

# 5. Multi-Business Support

One user may manage multiple independent businesses.

Example:

```text
Umar Trading
Zafar Lubricants
XYZ Services
```

Business switcher:

```text
Current Business
Zafar Lubricants ▼
```

Each business must have isolated:

- Parties
- Products
- Inventory
- Sales
- Purchases
- Payments
- Accounts
- Users
- Reports
- Settings
- Number sequences

---

# 6. First Launch Flow

Recommended first-launch screens:

1. Splash
2. Language selection
3. Welcome
4. Create New Business
5. Join Existing Business
6. Restore Backup
7. Authentication
8. Business setup wizard
9. Dashboard

Authentication options may include:

- Mobile number
- Email
- Password
- OTP
- PIN
- Biometric login

These must be configurable.

---

# 7. Language Architecture

Initial languages:

- English
- Urdu
- Arabic
- Hindi

Requirements:

- No hard-coded UI strings
- Android resource localization
- Server-returned labels should support translations where appropriate
- Urdu and Arabic must support RTL
- Date, currency, and number formatting must be locale-aware

---

# 8. Create Business Wizard

## 8.1 Basic Information

Fields:

- Business name
- Business type
- Phone
- Email
- Address
- City
- Country
- Postal code
- Website

## 8.2 Tax

Generic tax architecture:

```text
Tax Scheme
Tax Registration Number
Tax Rate
Tax Inclusive / Exclusive
Tax Components
```

Never hard-code GST as a mandatory architectural assumption.

---

# 9. Country Configuration

## Pakistan

```text
Currency = PKR
Currency Symbol = Rs
Tax Terminology = Sales Tax
Date = DD/MM/YYYY
```

## UAE

```text
Currency = AED
Tax = VAT
VAT Default = 5%
TRN Field
```

## India

```text
Currency = INR
GST
CGST
SGST
IGST
HSN/SAC
```

The tax engine should allow additional countries without restructuring the app.

---

# 10. Business Types

Suggested options:

```text
Retail
Wholesale
Distributor
Services
Manufacturing
Pharmacy
Grocery
Restaurant
Auto Parts
Lubricants
Electronics
Clothing
Other
```

Business type should only provide defaults.

It must not permanently restrict functionality.

---

# 11. Dashboard

Recommended home dashboard:

```text
Good Morning
Zafar Lubricants

Today's Sales
Rs 128,500

Today's Purchases
Rs 56,000

Receivable
Rs 420,000

Payable
Rs 165,000

Cash
Rs 85,000

Bank
Rs 1,420,000
```

Charts:

```text
Sales
7 Days | 30 Days | Year
```

Operational indicators:

```text
Low Stock
12 Items

Out of Stock
4 Items

Pending Orders
17

Overdue Payments
8
```

Dashboard cards must be configurable.

---

# 12. Home Quick Actions

Default:

```text
+ Sale
+ Purchase
+ Order
+ Payment In
+ Payment Out
```

Expandable actions:

```text
Quotation
Sales Order
Purchase Order
Delivery Challan
Expense
Income
Stock Adjustment
Party
Item
```

Visible actions should be configurable per role and business.

---

# 13. Main Navigation

Recommended bottom navigation:

```text
Home
Transactions
Items
Parties
More
```

Floating action button:

```text
+
```

---

# 14. Transactions

Centralized chronological transaction timeline.

Example:

```text
30 Sep

INV-0922
Ali Autos
SALE
Rs 24,850
Paid

SO-0182
ABC Motors
ORDER
Rs 18,200
Pending

PAY-092
Hassan Traders
PAYMENT IN
Rs 10,000
```

Filters:

- Today
- Yesterday
- This week
- This month
- Custom date range
- Sale
- Purchase
- Payment
- Expense
- Order
- Quotation
- Delivery
- User
- Customer
- Status

---

# 15. Party System

Internally use a generic `Party` model.

Party types:

```text
Customer
Supplier
Both
Other
```

---

# 16. Party Fields

Recommended fields:

```text
Party Name
Business Name
Contact Person
Mobile
WhatsApp
Phone
Email

Billing Address
Shipping Address

Tax Number
National ID / CNIC optional

Opening Balance
Credit Limit
Payment Terms

Price Level
Customer Group
Territory
Salesperson
Notes
```

Support multiple addresses.

---

# 17. Customer Profile

Header example:

```text
Ali Autos
Customer

Balance:
Rs 32,400 Receivable
```

Actions:

```text
Call
WhatsApp
Invoice
Order
Payment
Statement
```

Tabs:

```text
Overview
Transactions
Orders
Payments
Items
Statement
```

---

# 18. Customer Credit

Support:

```text
Credit Limit
Credit Days
Blocked Account
Overdue Warning
```

Example:

```text
Credit Limit: Rs 100,000
Outstanding: Rs 95,000

WARNING
Customer is near credit limit.
```

Optional hard block:

```text
Do not allow sale beyond credit limit
```

---

# 19. Customer Groups

Examples:

```text
Retail
Wholesale
Dealer
Distributor
VIP
Cash Customer
```

A customer group may define:

- Price list
- Discount
- Payment terms
- Tax rules
- Salesperson
- Territory

---

# 20. Product / Item System

Core product fields:

```text
Item ID
Name
SKU
Barcode
Category
Brand
Unit
Purchase Rate
Sale Rate
Wholesale Rate
MRP
Tax
Stock
Image
Description
```

---

# 21. Product Types

Support:

```text
Product
Service
Combo
Bundle
Manufactured Item
Expense Item
```

---

# 22. Product Images

Support:

- Main image
- Multiple additional images
- Thumbnail generation
- Compressed list-view images

Product-grid example:

```text
[Oil Image]

Shell Helix HX7
10W-40 · 4L
Stock 28

Rs 7,850
```

---

# 23. Categories

Support hierarchy:

```text
Lubricants
 ├ Engine Oil
 ├ Gear Oil
 ├ Brake Fluid
 └ Coolant
```

Prefer unlimited nesting if practical.

---

# 24. Brands

Separate `Brand` entity.

Examples:

```text
Shell
Mobil
Total
Castrol
Caltex
Liqui Moly
```

Reports should support brand-level filtering and analytics.

---

# 25. Units

Support:

```text
Piece
Bottle
Liter
Carton
Box
Dozen
Kg
Meter
```

Unit conversions:

```text
1 Carton = 12 Bottles
```

Example:

```text
Purchase:
5 Cartons

Stock:
60 Bottles
```

---

# 26. Multiple Prices

Each item may support:

```text
Purchase Price
Retail Price
Wholesale Price
Dealer Price
Minimum Price
MRP
```

Also support customer-specific or price-list-specific rates.

---

# 27. Party-Wise Price Memory

Example:

```text
Customer = Ali Autos
Last Shell HX7 Price = 7,350
```

Next order should suggest the last price.

---

# 28. Barcode Support

Support:

```text
EAN
UPC
Code 128
QR
Internal Barcode
```

Functions:

- Scan item
- Search item
- Add item
- Invoice item
- Stock count
- Purchase receiving

Support:

- Camera scanning
- Bluetooth scanners
- USB scanners behaving as keyboard input

---

# 29. Batch Tracking

Optional per item.

Fields:

```text
Batch Number
Manufacturing Date
Expiry Date
Purchase Price
Sale Price
MRP
Quantity
```

---

# 30. Serial Number Tracking

For electronics, batteries, machines, etc.

Example:

```text
Samsung TV

Serials:
SN28282
SN28283
SN28284
```

Sale removes the exact serial number.

---

# 31. Inventory Screen

Top cards:

```text
Inventory Value
Rs 4,250,000

Items
412

Low Stock
18
```

Filters:

```text
Category
Brand
Warehouse
Stock Status
```

---

# 32. Stock Status

States:

```text
In Stock
Low Stock
Out of Stock
Overstock
Inactive
```

---

# 33. Minimum Stock & Reorder Level

Example:

```text
Minimum = 10
Reorder = 30
```

Notification:

```text
Shell HX7 4L
Only 7 units remaining.
```

---

# 34. Warehouses

Support:

```text
Main Shop
Godown 1
Godown 2
Islamabad Store
Rawalpindi Store
```

Transactions may be warehouse-specific.

---

# 35. Stock Transfer

Workflow:

```text
From:
Main Warehouse

To:
Islamabad Branch

Items:
Shell HX7 × 20
Mobil 1 × 10
```

Statuses:

```text
Draft
Dispatched
Received
Cancelled
```

---

# 36. Stock Adjustment

Adjustment types:

```text
Opening Stock
Stock In
Stock Out
Damage
Expired
Lost
Found
Manual Correction
```

Require reason and optionally attachment/photo.

---

# 37. Stock Count

Physical stock-taking mode.

Example:

```text
Expected: 120
Counted: 117
Variance: -3
```

Action:

```text
Adjust Stock
```

---

# 38. Order Taking

Order taking should be a major module.

Two interfaces are recommended:

1. Standard order entry
2. Salesperson fast-order mode

---

# 39. Standard Order Entry

Flow:

```text
Select Customer
↓
Add Items
↓
Quantity
↓
Price
↓
Discount
↓
Delivery Details
↓
Save
```

---

# 40. Salesperson Fast Order Mode

Header:

```text
Customer: Ali Autos
Balance: Rs 18,400
Credit Limit: Rs 100,000
```

Product browser:

```text
Search
Scan Barcode

All | Shell | Mobil | Total
```

Product card:

```text
Shell HX7 4L
Stock: 26
Dealer Price: 7,500

[-] 2 [+]
```

Sticky bottom bar:

```text
14 Items
Rs 108,550

VIEW ORDER
```

---

# 41. Order Cart

Example:

```text
Shell HX7 4L
2 × 7,500 = 15,000

Mobil Super 4L
5 × 6,800 = 34,000
```

Support:

- Line discount
- Overall discount
- Free item
- Scheme
- Tax
- Delivery charge
- Notes

---

# 42. Order Status

Configurable statuses:

```text
Draft
Submitted
Confirmed
Processing
Packed
Dispatched
Partially Delivered
Delivered
Invoiced
Cancelled
Rejected
```

Prefer a reusable status/state engine.

---

# 43. Document Conversion

Core flow:

```text
Quotation
→ Sales Order
→ Delivery Challan
→ Invoice
→ Payment
```

Alternative:

```text
Sales Order
→ Invoice
```

No duplicate data entry.

---

# 44. Partial Order Fulfilment

Example order:

```text
Shell HX7: 20
Mobil 1: 10
```

Delivered:

```text
Shell HX7: 20
Mobil 1: 4
```

Remaining:

```text
Mobil 1: 6
```

Status:

```text
Partially Delivered
```

---

# 45. Backorders

Allow unfulfilled quantity to remain open.

---

# 46. Delivery Scheduling

Fields:

```text
Order Date
Expected Delivery
Route
Delivery Address
Vehicle
Driver
Notes
```

---

# 47. Delivery Challan

Fields:

```text
Challan Number
Customer
Shipping Address
Date
Order Reference
Items
Quantity
Driver
Vehicle
Transport
Remarks
```

Options:

```text
Show Prices
Hide Prices
```

---

# 48. Quotation / Estimate

Statuses:

```text
Draft
Sent
Viewed
Accepted
Rejected
Expired
Converted
```

Actions:

```text
Convert to Order
Convert to Invoice
```

---

# 49. Sales Invoice

Workflow:

```text
Customer
Invoice Number
Date
Due Date
Items
Discount
Tax
Additional Charges
Payment
Notes
Save
```

---

# 50. Invoice Modes

Support:

```text
Tax Invoice
Retail Invoice
Cash Invoice
Credit Invoice
Proforma Invoice
Service Invoice
POS Receipt
```

All should use one underlying invoice engine.

---

# 51. Automatic Numbering

Independent numbering sequences:

```text
Invoice:
INV-2026-00001

Quotation:
QT-2026-00001

Order:
SO-2026-00001

Purchase:
PUR-2026-00001
```

Configurable:

```text
Prefix
Suffix
Starting Number
Reset Yearly
Reset Monthly
Branch Prefix
```

---

# 52. Invoice Item Row

Fields:

```text
Item
Description
Qty
Unit
Rate
Discount
Tax
Amount
```

Optional fields:

```text
SKU
Barcode
Batch
Expiry
MRP
Serial
HSN/SAC
Warehouse
```

---

# 53. Discount System

Support:

## Line Discount

```text
10%
```

or

```text
Rs 500
```

## Invoice Discount

```text
5%
```

or fixed amount.

## Scheme

```text
Buy 10 Get 1
```

---

# 54. Additional Charges

Configurable:

```text
Delivery
Freight
Loading
Packing
Service Charge
Round Off
Other
```

Each charge can be taxable or non-taxable.

---

# 55. Payment While Invoicing

Options:

```text
Unpaid
Fully Paid
Partially Paid
```

Example:

```text
Invoice = 100,000
Received = 40,000
Balance = 60,000
```

---

# 56. Payment Modes

Configurable list:

```text
Cash
Bank
Card
Cheque
UPI
JazzCash
EasyPaisa
Bank Transfer
Credit
Other
```

Do not hard-code payment options.

---

# 57. Payment In

Fields:

```text
Customer
Amount
Date
Payment Account
Reference
Notes
Invoice Allocation
```

Allocation options:

```text
Automatically Allocate Oldest Invoices
Manual Allocation
```

---

# 58. Payment Out

Equivalent architecture for supplier payments.

---

# 59. Payment Receipt

Generate PDF/print/share.

Example:

```text
Payment Receipt

Received From:
Ali Autos

Rs 25,000

Against Invoice:
INV-01322
```

---

# 60. Purchase

Purchase workflow mirrors sales:

```text
Supplier
Bill Number
Date
Items
Purchase Rate
Tax
Additional Charges
Payment
```

A purchase should:

- Increase stock
- Increase payable if credit
- Update cost
- Generate accounting entries

---

# 61. Purchase Order

Statuses:

```text
Draft
Sent
Confirmed
Partially Received
Received
Closed
Cancelled
```

Conversion:

```text
Purchase Order
→ Purchase
```

---

# 62. Purchase Receiving

Example:

```text
Ordered = 50
Received = 42
Pending = 8
```

Batch/expiry can be recorded during receiving.

---

# 63. Purchase Return

Select source purchase, then:

```text
Items
Quantity
Reason
```

System should:

- Reduce supplier payable
- Reduce stock
- Generate accounting entries

---

# 64. Sales Return

Select original invoice.

Fields:

```text
Item
Qty
Reason
Refund Mode
```

Stock should be restored when appropriate.

---

# 65. Credit Notes

Support standalone or invoice-linked credit notes.

---

# 66. Debit Notes

Support supplier-side adjustments.

---

# 67. Expenses

Default categories:

```text
Rent
Electricity
Fuel
Salary
Delivery
Repair
Office
Advertising
Miscellaneous
```

Expense form:

```text
Date
Category
Party
Amount
Tax
Payment Account
Description
Attachment
```

---

# 68. Other Income

Examples:

```text
Commission
Rent
Interest
Service Income
Miscellaneous
```

Track separately from sales.

---

# 69. Cash & Bank Accounts

Examples:

```text
Cash
Meezan Bank
HBL
JazzCash
EasyPaisa
Petty Cash
```

---

# 70. Bank Transaction Types

```text
Deposit
Withdrawal
Transfer
Payment In
Payment Out
Opening Balance
Adjustment
```

---

# 71. Account Transfer

Example:

```text
Cash
↓
Meezan Bank
Rs 100,000
```

System must create balanced journal entries.

---

# 72. Cheque Module

Optional fields:

```text
Cheque Number
Bank
Customer
Amount
Received Date
Deposit Date
Status
```

Statuses:

```text
Received
Deposited
Cleared
Bounced
Cancelled
```

---

# 73. Accounting Engine

Do not calculate financial reports independently from UI transactions.

Create a proper journal engine.

Core tables:

```text
accounts
journal_entries
journal_lines
```

Example credit sale:

```text
Customer Receivable   Dr 100,000
Sales Revenue         Cr 100,000
```

Customer payment:

```text
Cash                  Dr 100,000
Customer Receivable   Cr 100,000
```

---

# 74. Chart of Accounts

Default classes:

```text
Assets
Liabilities
Equity
Income
Cost of Goods Sold
Expenses
Other Income
```

Allow custom accounts.

---

# 75. Reports

Main sections:

```text
Business
Sales
Purchases
Party
Inventory
Accounting
Expenses
Orders
Taxes
Users
```

---

# 76. Business Reports

Include:

```text
Dashboard Summary
Profit & Loss
Balance Sheet
Cash Flow
Trial Balance
Day Book
General Ledger
All Transactions
```

---

# 77. Sales Reports

Include:

```text
Sales Summary
Sales by Day
Sales by Month
Sales by Customer
Sales by Item
Sales by Category
Sales by Brand
Sales by Salesperson
Sales by Warehouse
Sales by Area
Bill-wise Profit
Item-wise Profit
```

---

# 78. Purchase Reports

Equivalent purchase views.

---

# 79. Outstanding Report

Tabs:

```text
Receivable
Payable
```

Example:

```text
Ali Autos
Rs 85,000
17 Days Overdue

Khan Autos
Rs 21,500
Due Tomorrow
```

---

# 80. Aging Report

Buckets:

```text
Current
1–30 Days
31–60 Days
61–90 Days
90+ Days
```

---

# 81. Customer Statement

Example:

```text
Opening Balance

Invoice        +50,000
Payment        -20,000
Invoice        +10,000

Closing:
40,000 Dr
```

Actions:

```text
PDF
WhatsApp
Email
Print
```

---

# 82. Inventory Reports

Include:

```text
Stock Summary
Stock Detail
Stock Valuation
Low Stock
Out of Stock
Stock Movement
Batch Report
Expiry Report
Serial Report
Warehouse Report
Category Report
Brand Report
Fast Moving
Slow Moving
Dead Stock
```

---

# 83. Order Reports

Include:

```text
Open Orders
Pending Orders
Orders by Customer
Orders by Item
Orders by Salesman
Partially Delivered
Cancelled
Delivery Performance
```

---

# 84. Profit Calculation

Configurable costing method:

```text
Weighted Average
FIFO
Last Purchase Price
Standard Cost
```

Weighted average is a good initial implementation.

---

# 85. Report Filter Engine

Reusable filters:

```text
Date
Branch
Warehouse
User
Party
Party Group
Item
Category
Brand
Transaction Type
Status
```

---

# 86. Export

Reports should support:

```text
PDF
Excel
CSV
Print
Share
```

---

# 87. Invoice Theme Engine

This is a separate subsystem.

---

# 88. Built-In Invoice Themes

Examples:

```text
Classic
Modern
Minimal
Corporate
Elegant
Retail
Wholesale
Service
Thermal
Compact
```

---

# 89. Invoice Theme Colors

Live-configurable:

```text
Primary
Accent
Header
Text
Table Header
Border
```

Preview must update immediately.

---

# 90. Invoice Logo

Controls:

```text
Show Logo

Position:
Left
Center
Right

Size:
Small
Medium
Large
```

---

# 91. Company Information Visibility

Toggles:

```text
✓ Company Name
✓ Address
✓ Phone
✓ Email
✓ Tax Number
✓ Website
✓ Logo
```

---

# 92. Invoice Field Visibility

Toggles:

```text
✓ Invoice Number
✓ Invoice Date
✓ Due Date
✓ Customer Tax Number
✓ Shipping Address
✓ Salesperson
✓ Order Reference
```

---

# 93. Item Table Configuration

Allow reordering of columns:

```text
Item
SKU
Description
Qty
Rate
Discount
Tax
Amount
```

Enable/disable columns individually.

Allow width configuration where practical.

---

# 94. Document Terminology

White-label terminology must be configurable.

Examples:

```text
Sale → Invoice
Sale → Tax Invoice
Sale → Cash Memo
Quotation → Estimate
Customer → Dealer
Party → Account
```

---

# 95. Invoice Footer

Configurable:

```text
Terms & Conditions
Thank-you Message
Bank Details
Payment QR
Signature
Stamp
Footer Text
```

---

# 96. Signature

Options:

```text
Uploaded Signature
Digital Signature Image
Authorized Signatory Name
```

---

# 97. Page Types

Support:

```text
A4
A5
Letter
Custom
58 mm Thermal
80 mm Thermal
```

---

# 98. Thermal Printing

Android support:

- Bluetooth
- USB
- Network printer
- ESC/POS abstraction layer

Features:

```text
Logo
Shop Name
Invoice
Items
Tax
Total
QR
Footer
Auto Cut
Cash Drawer
```

---

# 99. Print Preview

Actions:

```text
Preview
Print
Download PDF
Share
```

---

# 100. Native Android Sharing

Use Android native share intents.

Targets may include:

- WhatsApp
- WhatsApp Business
- Gmail
- Messages
- Drive
- Bluetooth
- Other installed apps

Do not force browser-based WhatsApp.

---

# 101. WhatsApp Sharing

Support:

```text
Invoice PDF
Order PDF
Quotation
Statement
Payment Reminder
Catalog
```

---

# 102. Payment Reminder Templates

Example:

```text
Hello Ali Autos,

Invoice INV-0182 for Rs 25,800 is overdue.
```

Templates must be editable.

---

# 103. Automatic Payment Reminders

Rules:

```text
3 Days Before
Due Date
3 Days After
7 Days After
Every 7 Days
```

Can be enabled/disabled per customer.

---

# 104. Notifications

Notification types:

```text
Low Stock
Order Received
Order Approved
Payment Overdue
Payment Received
Backup Completed
Sync Error
Stock Expiry
Purchase Due
Credit Limit Warning
```

---

# 105. Online Catalog / Store

Company may expose selected inventory publicly.

Example:

```text
zafarlubricants.yourapp.com
```

Product card:

```text
Image
Name
Price
Description
Availability
```

---

# 106. Public Order

Customer may:

```text
Select Items
Enter Quantity
Enter Name
Mobile
Address
Submit
```

Order enters app as:

```text
NEW ONLINE ORDER
```

---

# 107. Order Approval

Owner actions:

```text
Accept
Reject
Edit
Call Customer
WhatsApp
```

Accepted order can become a sales order.

---

# 108. Salesperson Mode

Salesperson dashboard:

```text
My Customers
My Route
Take Order
Collections
My Sales
Targets
```

By default, salespeople should not see:

```text
Profit
Purchase Cost
Company Bank Balance
Other Salespeople's Sensitive Data
P&L
```

---

# 109. Salesperson Route

Example:

```text
Monday Route

1. Ali Autos
2. City Oil
3. Ahmed Traders
4. Khan Motors
```

Visit actions:

```text
Visited
Order
No Order
Closed
Reschedule
```

---

# 110. Visit Tracking

Optional.

Example:

```text
Visit Started
09:42 AM

Visit Ended
09:56 AM
```

GPS should only be used if explicitly enabled by the company.

---

# 111. Collection Mode

Salesperson can collect payment.

Fields:

```text
Customer
Outstanding
Collection Amount
Payment Mode
Reference
Receipt
```

---

# 112. User Management

Suggested default roles:

```text
Owner
Admin
Manager
Accountant
Salesperson
Cashier
Biller
Stock Manager
Delivery
Viewer
Custom
```

---

# 113. Permission Engine

Do not hard-code role permissions.

Example:

```text
Sales
  View
  Create
  Edit
  Delete
  Discount
  Override Price

Purchases
  View
  Create
  Edit
  Delete

Inventory
  View
  Add
  Adjust

Reports
  Sales
  Profit
  Purchase
  Tax

Settings
  View
  Edit
```

---

# 114. Sensitive Permissions

Separate controls:

```text
View Purchase Price
View Cost
View Profit
View Bank Balance
Delete Transaction
Back-Date Transaction
Edit Old Transaction
Give Discount
Override Minimum Price
Export Data
Backup
Manage Users
```

---

# 115. PIN Security

Same-device user switching can support:

```text
User
4-Digit PIN
```

---

# 116. Audit Log

Example:

```text
09:15
Invoice INV-0182 Created
by Ali

09:18
Invoice Changed
Qty 10 → 12
by Manager

09:21
Payment Added
Rs 20,000
by Umar
```

Audit entries must never be silently altered.

---

# 117. Delete Control

Use soft deletion for important business data.

Record:

```text
Deleted By
Date
Reason
Previous Data
```

---

# 118. Offline-First Architecture

Normal business operation must not depend on live internet.

Recommended local database:

```text
Room / SQLite
```

---

# 119. Offline Operations

Should work offline:

```text
Create Invoice
Create Order
Add Customer
Add Product
Receive Payment
Add Purchase
View Cached Reports
Print
Generate PDF
```

---

# 120. Sync Engine

Every sync-enabled record should contain fields similar to:

```text
id
server_id
created_at
updated_at
device_id
user_id
sync_status
revision
deleted_at
```

---

# 121. Sync Status

Example:

```text
Synced ✓
```

or:

```text
3 Changes Waiting
```

---

# 122. Conflict Resolution

If two devices edit the same record:

- Use revision numbers
- Detect conflicts server-side
- Do not silently overwrite sensitive transactions
- Provide conflict-resolution UI where necessary

---

# 123. Multi-Device

Target architecture:

```text
Android Phone
Android Tablet
Web Admin
Future Desktop
```

All use the same backend.

---

# 124. Backup

Backup options:

```text
Automatic Cloud Backup
Manual Backup
Local Export
Restore
```

---

# 125. Automatic Backup

Options:

```text
Daily
Weekly
Wi-Fi Only
Encrypted
```

---

# 126. Backup File

Example:

```text
business_2026-09-30.busbackup
```

Backup should be encrypted.

---

# 127. Restore

Wizard:

```text
Select File
Verify
Show Backup Date
Show Business Name
Show Record Count
Restore
```

Never overwrite silently.

---

# 128. Attachments

Transactions may contain:

```text
Photo
PDF
Receipt
Supplier Invoice
Delivery Photo
Other Document
```

---

# 129. Global Search

Search examples:

```text
Ali Autos
INV-0182
Shell HX7
0333...
Barcode
```

Grouped results:

```text
Customers
Items
Invoices
Orders
Payments
```

---

# 130. Recent Items

Order-entry search should prioritize:

```text
Recently Sold
Frequently Sold
Customer History
```

---

# 131. Favorites

Salespeople may star frequently used products.

Example:

```text
★ Shell HX7
★ Mobil Super
```

---

# 132. Customer Purchase History

Example:

```text
Previously Purchased

Shell HX7
Last Ordered: 14 Days Ago
Qty: 12
```

Action:

```text
REPEAT
```

---

# 133. Repeat Order

Customer profile action:

```text
Repeat Last Order
```

This loads previous items into a new draft.

---

# 134. Custom Fields

Allow custom fields for parties, products, transactions, and invoices.

## Party

```text
CNIC
Dealer Code
Territory
License Number
```

## Product

```text
Vehicle Type
Viscosity
OEM Code
Size
```

## Invoice

```text
Vehicle Number
PO Number
Technician
```

---

# 135. Custom Field Types

Support:

```text
Text
Number
Date
Dropdown
Checkbox
Phone
Email
Currency
```

---

# 136. Feature Toggles

Admin should be able to hide unused modules.

Example:

```text
Inventory ✓
Tax ✓
Orders ✓
Purchase ✓
Online Store ✗
Batch Tracking ✗
Serial Numbers ✗
Accounting ✓
Delivery Challan ✓
```

---

# 137. Custom Home Menu

Allow menu reordering:

```text
Sales
Orders
Stock
Customers
Payments
```

Allow hiding unused options.

---

# 138. App Theme Selection

Modes:

```text
Light
Dark
System
```

Style presets:

```text
Classic
Modern
Compact
Large Touch
```

---

# 139. Custom Color Theme

Business can choose:

```text
Primary
Secondary
Accent
```

Developer must enforce accessible contrast.

---

# 140. Large Touch Mode

Useful for:

- Shop counters
- Tablets
- Older users
- Field-sales staff

---

# 141. Text Size

Options:

```text
Small
Normal
Large
Extra Large
```

---

# 142. RTL

Arabic and Urdu must be supported correctly.

This includes:

- Layout direction
- Icons where appropriate
- Text alignment
- Number formatting
- Forms
- Tables
- PDF generation

---

# 143. Date Format

Options:

```text
DD/MM/YYYY
MM/DD/YYYY
YYYY-MM-DD
```

---

# 144. Number Format

Support:

```text
1,000,000
10,00,000
```

---

# 145. Currency

Fields:

```text
Currency Code
Symbol
Symbol Position
Decimals
```

Examples:

```text
Rs 10,000
AED 10,000
$10,000
```

---

# 146. Fiscal Year

Support:

```text
Jan–Dec
Jul–Jun
Custom
```

---

# 147. POS Mode

Separate optimized counter screen.

Main functions:

```text
Scan
Search
Quantity
Discount
Hold
Pay
Print
```

---

# 148. Hold Sale

Cashier can:

```text
Hold Bill
```

and resume it later.

---

# 149. Walk-In Customer

Default POS customer:

```text
Walk-In Customer
```

No customer creation required.

---

# 150. Quick Cash Payment

Buttons:

```text
Exact
500
1000
5000
Other
```

Calculate change automatically.

---

# 151. Cash Drawer

Opening:

```text
Opening Cash
```

Closing:

```text
Expected
Actual
Difference
```

---

# 152. Shift System

Optional:

```text
Open Shift
Sales
Returns
Cash
Card
Expenses
Close Shift
```

---

# 153. Price Override

Example:

```text
7,500 → 7,100
```

If permission is missing:

```text
Manager PIN Required
```

---

# 154. Discount Approval

Use the same manager-override mechanism.

---

# 155. Multi-Branch

Hierarchy:

```text
Organization
 ├ Rawalpindi Branch
 ├ Islamabad Branch
 └ Lahore Branch
```

Each branch may have:

- Warehouse
- Users
- Cash
- Invoice series
- Reports

Head office can view consolidated reporting.

---

# 156. Branch Inventory

Example:

```text
Shell HX7

Rawalpindi: 42
Islamabad: 18
Lahore: 30

Total: 90
```

---

# 157. Targets

Optional salesperson target types:

```text
Sales Value
Collection
Orders
New Customers
Specific Product
Brand
```

---

# 158. Salesperson Dashboard

Example:

```text
Today's Sales
Rs 45,800

Orders
7

Collections
Rs 25,000

Target
72%
```

---

# 159. Customer Territory

Examples:

```text
Saddar
PWD
Bahria
Rawat
Blue Area
I-10
```

---

# 160. Customer Location

Optional GPS location.

Must only be collected when the company enables location tracking.

---

# 161. Delivery Module

Delivery user screen:

```text
Today's Deliveries

Ali Autos
Rs 38,000
3 Cartons

NAVIGATE
DELIVERED
FAILED
```

---

# 162. Delivery Proof

Optional:

```text
Customer Signature
Photo
Receiver Name
Delivery Note
```

---

# 163. Failed / Partial Delivery

Reasons:

```text
Partial Delivery
Customer Rejected
Shop Closed
Incorrect Order
Other
```

---

# 164. Dashboard Widget Configuration

Business owner may choose visible widgets.

Example:

```text
✓ Sales
✓ Receivable
✓ Stock
✗ Expenses
✓ Orders
```

---

# 165. Notification Center

Example:

```text
Today

Low Stock
Mobil 1 only 4 units

Order
New Order SO-221

Payment
Ali Autos paid Rs 20,000
```

---

# 166. Data Import

Import:

```text
Items
Customers
Suppliers
Opening Balances
Stock
Prices
```

Formats:

```text
Excel
CSV
```

---

# 167. Import Mapping

Example:

```text
Excel Column → App Field

Product Name → Name
Code → SKU
Qty → Opening Stock
Price → Sale Price
```

---

# 168. Duplicate Detection

Warn on possible duplicate:

```text
Mobile
Tax Number
SKU
Barcode
Customer Name
```

---

# 169. Data Export

Owner should be able to export business data.

Avoid vendor lock-in.

---

# 170. Activity Log

Separate from accounting audit.

Track:

```text
Login
Logout
Data Export
User Created
Settings Changed
Backup
Restore
```

---

# 171. Settings Structure

Recommended sections:

```text
Business Profile
Preferences
Features
Transactions
Items
Parties
Tax
Payments
Invoice & Print
Themes
Users & Permissions
Notifications
Orders
Inventory
Sync
Backup
Security
Data Import/Export
About
Support
```

---

# 172. Business Profile

Contains:

```text
Logo
Name
Phone
Email
Tax Number
Address
Bank Details
Signature
```

---

# 173. Transaction Settings

Options:

```text
Default Payment Type
Round Off
Discount
Due Dates
Shipping
Custom Fields
Additional Charges
Invoice Numbering
```

---

# 174. Inventory Settings

Options:

```text
Maintain Stock
Allow Negative Stock
Low Stock Alerts
Batch
Expiry
Serial
Warehouse
Units
Categories
Brands
```

---

# 175. Negative Stock

Setting:

```text
Never Allow
Warn
Allow
```

---

# 176. Purchase Cost Visibility

Can be hidden from:

- Salespeople
- Cashiers
- Delivery staff
- Other custom roles

---

# 177. Profit Visibility

Owner/Admin only by default.

---

# 178. Lock Closed Period

Example:

```text
Transactions Before:
30 Sep 2026

LOCKED
```

Requires authorized override.

---

# 179. Core Domain Models

Recommended entities:

```text
Tenant
Business
Branch
Warehouse

User
Role
Permission
UserBusiness

Party
PartyAddress
PartyGroup

Item
ItemVariant
Category
Brand
Unit
UnitConversion
PriceList
PartyPrice

StockLedger
StockBatch
SerialNumber
StockTransfer
StockAdjustment

Quotation
QuotationItem

SalesOrder
SalesOrderItem

DeliveryChallan
DeliveryChallanItem

Invoice
InvoiceItem

SalesReturn
CreditNote

PurchaseOrder
PurchaseOrderItem

Purchase
PurchaseItem
PurchaseReturn

Payment
PaymentAllocation

Expense
ExpenseCategory

OtherIncome
IncomeCategory

Account
JournalEntry
JournalLine

Tax
TaxRate

Theme
InvoiceTemplate

Attachment
Notification
Reminder

AuditLog
ActivityLog

SyncQueue
BackupRecord
```

---

# 180. Inventory Ledger

Do not rely only on:

```text
item.quantity
```

Maintain stock movements:

```text
Opening +100
Purchase +20
Sale -5
Return +1
Adjustment -2
```

Current stock may be:

- Calculated from ledger
- Cached for speed
- Rebuilt from ledger if needed

---

# 181. Transaction History / Immutability

For stricter accounting:

```text
Reverse + Recreate
```

For SME mode, editing may be allowed but every change must be audited.

---

# 182. Server Architecture

Suggested architecture:

```text
Android App
      │
      │ REST / WebSocket
      ▼
Backend API
      │
      ├ PostgreSQL
      ├ Object Storage
      ├ Redis
      ├ Notification Service
      └ Background Jobs
```

---

# 183. Recommended Android Stack

```text
Kotlin
Jetpack Compose
Room
Retrofit or Ktor Client
WorkManager
Hilt
Coroutines / Flow
CameraX
ML Kit Barcode
DataStore
```

---

# 184. Recommended Backend Stack

Option A:

```text
Node.js
NestJS
PostgreSQL
Redis
S3-Compatible Object Storage
Firebase Cloud Messaging
```

Option B:

```text
FastAPI
PostgreSQL
Redis
S3-Compatible Object Storage
Firebase Cloud Messaging
```

---

# 185. Web Admin

Future web admin:

```text
React / Next.js
```

Possible capabilities:

- Company management
- Reports
- Users
- Inventory
- White-label configuration
- Subscription
- Support
- Global settings

---

# 186. Multi-Tenancy

Every business-owned table should include:

```text
tenant_id
business_id
```

Backend must enforce tenant isolation.

Never rely only on frontend filtering.

---

# 187. IDs

Use UUID or ULID for synchronized records.

Example:

```text
01K123...
```

Visible invoice number remains human-friendly:

```text
INV-00021
```

---

# 188. Local ID Generation

Offline-created records need stable IDs generated on device.

Use UUID/ULID.

---

# 189. Sync Queue

Local operation creates a queued operation:

```text
SyncOperation
CREATE
Invoice
ID xyz
```

WorkManager sends it when connectivity returns.

---

# 190. Security

Requirements:

- HTTPS only
- Secure token storage
- Refresh tokens encrypted
- Password hashing server-side
- Optional local database encryption
- Role-based authorization server-side
- Tenant authorization server-side

---

# 191. Biometrics

Optional:

```text
Fingerprint
Face Unlock
```

Use Android biometric APIs.

---

# 192. App Lock

Options:

```text
Immediately
1 Minute
5 Minutes
30 Minutes
Never
```

---

# 193. Screenshot Security

Optional company setting:

```text
Allow Screenshots
Block Screenshots
```

---

# 194. Session Management

Owner can view:

```text
Samsung S9+
Last Active Today

Office Tablet
Last Active 2 Min Ago
```

Action:

```text
Sign Out Device
```

---

# 195. Subscription / Licensing

Example plans:

## Basic

```text
1 User
Invoices
Customers
Items
Basic Reports
```

## Business

```text
5 Users
Inventory
Orders
Purchases
Advanced Reports
```

## Enterprise

```text
Unlimited Users
Multi-Branch
API
Custom Branding
```

Plan entitlements should be server-driven.

---

# 196. Feature Entitlements

Example backend response:

```json
{
  "inventory": true,
  "orders": true,
  "multi_branch": false,
  "users_max": 5
}
```

App should render capabilities dynamically.

---

# 197. White-Label License

A client may receive:

```text
Brand A
Theme A
Modules A
Pricing A
```

Another client receives a completely different configuration.

---

# 198. Remote Config

Useful for:

```text
Maintenance Message
Minimum Version
Feature Toggle
Support Number
API Flags
```

---

# 199. Update System

App should check:

```text
Current Version
Latest Version
Minimum Supported Version
```

Messages:

```text
Update Available
```

or mandatory update.

---

# 200. Error Logging

Track:

```text
Crash
API Error
Sync Error
Printer Error
PDF Error
```

Avoid collecting sensitive financial data unnecessarily.

---

# 201. Sync Diagnostics

Support screen:

```text
Last Sync
2 Minutes Ago

Pending
0

Failed
0

Device ID
ABC...

API
Connected
```

---

# 202. Printer Diagnostics

Test:

```text
Bluetooth Connection
Paper Width
Print Test
Character Set
QR
Drawer
Cut
```

---

# 203. Local Logs

Support:

```text
Export Diagnostic Logs
```

Do not include sensitive business content unless the user explicitly approves.

---

# 204. Support Section

Settings:

```text
Help Center
WhatsApp Support
Call Support
Email Support
Send Diagnostics
About
```

All support information must be white-label configurable.

---

# 205. Empty States

Example:

```text
No Customers Yet

Add your first customer to create invoices and track payments.

+ ADD CUSTOMER
```

---

# 206. Onboarding Tips

Example:

```text
Scan a barcode to quickly add an item.
```

Tips should be dismissible.

---

# 207. Confirmation Rules

Require confirmation for:

```text
Delete
Cancel Invoice
Restore Backup
Stock Adjustment
Close Shift
Remove User
```

Avoid excessive confirmations for normal navigation.

---

# 208. Undo

For non-financial actions:

```text
Customer Archived

UNDO
```

---

# 209. Archive

Prefer archive instead of delete for:

```text
Products
Customers
Categories
Brands
```

Historical transactions must still display archived records.

---

# 210. Product Variants

Optional:

```text
Shell HX7

1L
4L
5L
20L
```

Possible dimensions:

```text
Size
Color
Pack
```

---

# 211. Product Attributes

Business-defined attributes may include:

```text
Viscosity
Vehicle Type
Brand
Package
Grade
```

---

# 212. Combo / Bundle

Example:

```text
Oil Change Package

Engine Oil × 1
Oil Filter × 1
Service × 1
```

---

# 213. Stock Reservation

Setting:

```text
Reserve Stock When:
Order Submitted
Order Confirmed
Never
```

Inventory example:

```text
Physical: 100
Reserved: 30
Available: 70
```

---

# 214. Scheme Engine

Rules:

```text
Buy 10 Get 1 Free

Buy Rs 100,000
Get 5% Discount

Buy Brand X
Get Item Y Free
```

---

# 215. Promotion Validity

Rules may use:

```text
Start Date
End Date
Customer Group
Product
Category
Brand
Quantity
```

---

# 216. Price Lists

Examples:

```text
Retail
Wholesale
Dealer
VIP
Islamabad
Rawalpindi
```

Assign one or more to customers/groups.

---

# 217. Customer-Specific Discount

Example:

```text
Ali Autos
Default Discount: 3%
```

---

# 218. Order Minimum

Optional:

```text
Minimum Order:
Rs 5,000
```

---

# 219. Free Delivery Rule

Example:

```text
Free Delivery Above Rs 20,000
```

---

# 220. Tax Engine

Do not embed country-specific tax logic in UI code.

Recommended concepts:

```text
TaxDefinition
TaxComponent
TaxRule
```

Examples:

UAE:

```text
VAT 5%
```

India:

```text
CGST 9%
SGST 9%
```

Pakistan:

```text
Sales Tax 18%
```

---

# 221. Tax Inclusive / Exclusive

Example:

```text
Price = Rs 118
Inclusive Tax = 18%

Base = 100
Tax = 18
```

---

# 222. Tax Exemption

Product/customer tax status:

```text
Taxable
Exempt
Zero Rated
```

---

# 223. Rounding

Rules:

```text
No Rounding
Nearest 1
Nearest 0.50
Nearest 0.01
```

---

# 224. Receipt QR

May encode:

```text
Invoice URL
Payment URL
Bank URI
Verification URL
```

---

# 225. Document QR

Example:

```text
https://app.example.com/i/ABC123
```

Customer can view invoice online.

---

# 226. Customer Document Portal

Optional page:

```text
Invoice
Amount
Paid
Due
Download
Pay
```

---

# 227. Customer Portal

Future functionality:

```text
Orders
Invoices
Statements
Payments
Catalog
```

---

# 228. API

Enterprise endpoints:

```text
/items
/parties
/orders
/invoices
/payments
/stock
/reports
```

---

# 229. Webhooks

Examples:

```text
invoice.created
payment.received
order.created
stock.low
```

---

# 230. UI Design System

Reusable UI components:

```text
AppButton
AppCard
AppTextField
MoneyField
QuantityStepper
PartySelector
ItemSelector
DateSelector
FilterChip
StatusChip
BottomSheet
ConfirmationDialog
EmptyState
```

Do not design each screen from scratch.

---

# 231. Responsive Layout

Support:

```text
Small Android Phones
Normal Android Phones
Tablets
Foldables
```

Do not assume only modern large screens.

---

# 232. Android Compatibility

Recommended starting point:

```text
minSdk 26
```

This supports Android 8+ and includes older devices such as Samsung Galaxy S9+ class hardware.

Dependencies should still be checked before finalizing the minimum SDK.

---

# 233. Performance Targets

Application should be designed to support approximately:

```text
100,000+ Transactions
50,000 Items
50,000 Customers
```

Do not load entire datasets into Compose lists.

Use:

- Paging
- Indexes
- Efficient SQL queries
- Background processing

---

# 234. Search Debounce

Local search debounce:

```text
150–300 ms
```

---

# 235. Image Optimization

Product photos:

- Optional original image
- Thumbnail
- Compressed preview
- Lazy loading

Do not load huge source images into product lists.

---

# 236. Database Indexes

Important indexes:

```text
business_id
party_id
item_id
date
invoice_number
barcode
sku
status
warehouse_id
```

---

# 237. Money Storage

Never use binary floating-point for money.

Android:

```text
BigDecimal
```

Backend:

```text
Decimal / Numeric
```

Alternatively, smallest currency-unit integer where appropriate.

---

# 238. Quantity Precision

Support:

```text
1
1.5
1.250
```

Make decimal precision configurable.

---

# 239. Time Zones

Store server timestamps in UTC.

Each business has a configured time zone.

Display time in the business/user local time zone.

---

# 240. UX Principle

Common orders and sales should require very few taps.

Ideal field-order flow:

```text
Customer
→ Products
→ Quantity
→ Save
```

All advanced fields should be optional or collapsible.

---

# 241. Quick Customer Add

Inside invoice/order:

```text
+ New Customer
```

Minimum required:

```text
Name
Phone
```

Everything else optional.

---

# 242. Quick Product Add

Inside invoice/order:

```text
+ New Item
```

Minimum:

```text
Name
Sale Price
```

Optional:

```text
Stock
Tax
Barcode
```

---

# 243. Duplicate Invoice / Document

Action:

```text
Duplicate
```

Creates a new draft.

---

# 244. Universal Convert Action

Example:

```text
Convert To...
```

Possible flow:

```text
Quotation
→ Order
→ Delivery
→ Invoice
```

---

# 245. Share After Save

Example:

```text
Invoice Saved

PRINT
SHARE
NEW SALE
DONE
```

---

# 246. Custom Save Action

Setting:

```text
After Save:
Return Home
Open Invoice
Start New Invoice
Open Share Screen
```

---

# 247. Keyboard-First Mode

Future enhancement for:

- Tablets
- USB scanners
- Hardware keyboards

---

# 248. Voice Search

Optional future feature.

Example:

```text
"Shell HX7 four liter"
```

---

# 249. OCR Purchase Entry

Optional later phase.

Camera may identify:

```text
Supplier
Date
Total
Items
Tax
```

Do not make this a V1 requirement.

---

# 250. Recommended Build Phases

Do not implement all modules simultaneously.

---

## Phase 1 — Foundation

Build:

```text
Authentication
Business Creation
White Label
Theme Engine
Users
Local Database
Sync Architecture
Settings
```

---

## Phase 2 — Master Data

Build:

```text
Customers / Suppliers
Items
Categories
Brands
Units
Warehouses
Price Lists
```

---

## Phase 3 — Sales

Build:

```text
Quotation
Sales Order
Invoice
Payment In
Customer Statement
Sales Return
```

---

## Phase 4 — Inventory

Build:

```text
Inventory Ledger
Stock Adjustment
Stock Transfer
Low Stock
Batch
Serial
```

---

## Phase 5 — Purchase

Build:

```text
Purchase Order
Purchase
Payment Out
Purchase Return
```

---

## Phase 6 — Accounting

Build:

```text
Accounts
Journal Entries
Expenses
Other Income
Cash / Bank
Profit & Loss
Balance Sheet
```

---

## Phase 7 — Reports

Implement detailed reporting.

---

## Phase 8 — Printing

Build:

```text
PDF
Invoice Themes
Thermal Printing
Bluetooth Printing
Android Native Sharing
```

---

## Phase 9 — Field Sales

Build:

```text
Fast Order
Routes
Collections
Targets
Delivery
```

---

## Phase 10 — Cloud Features

Build:

```text
Online Store
Customer Portal
Web Admin
Advanced Sync
Notifications
API
```

---

# 251. Core Screen List

Expected major screens:

1. Splash
2. Language
3. Login
4. OTP
5. Create Business
6. Join Business
7. Restore
8. Dashboard
9. Business Switcher
10. Transaction List
11. Transaction Details
12. Customer List
13. Customer Details
14. Add Customer
15. Supplier List
16. Party Group
17. Product List
18. Product Details
19. Add Product
20. Category
21. Brand
22. Units
23. Warehouse
24. Stock
25. Stock Details
26. Stock Adjustment
27. Stock Transfer
28. Stock Count
29. Barcode Scanner
30. Quotation List
31. Create Quotation
32. Quotation Details
33. Order List
34. Fast Order
35. Cart
36. Order Details
37. Delivery Challan
38. Invoice List
39. Create Invoice
40. Invoice Details
41. Sales Return
42. Payment In
43. Payment Receipt
44. Purchase List
45. Purchase Entry
46. Purchase Order
47. Purchase Return
48. Payment Out
49. Expenses
50. Expense Entry
51. Other Income
52. Cash Accounts
53. Bank Accounts
54. Bank Transfer
55. Customer Statement
56. Receivable
57. Payable
58. Reports Home
59. Sales Reports
60. Inventory Reports
61. Profit & Loss
62. Balance Sheet
63. Cash Flow
64. Order Reports
65. Invoice Themes
66. Print Preview
67. Printer Settings
68. User List
69. User Details
70. Roles
71. Permissions
72. Activity Log
73. Notifications
74. Online Store
75. Online Order
76. Route
77. Visit
78. Delivery List
79. Settings
80. Business Profile
81. Feature Toggles
82. Transaction Settings
83. Inventory Settings
84. Tax Settings
85. Payment Settings
86. Backup
87. Restore
88. Sync Status
89. Security
90. About / Support

Additional dialogs, filters, sheets, and popups will increase the total UI count.

---

# 252. Key Improvements Over a Basic Vyapar-Style Clone

## 252.1 Strong White-Label Architecture

The product should be a platform, not a single-brand app.

## 252.2 Better Field-Sales Order Taking

Use:

- Product images
- Brand filters
- Customer history
- Repeat order
- Fast quantity controls
- Route-based customer lists

## 252.3 International Tax Architecture

Do not make GST a system dependency.

## 252.4 Feature Toggles

Each business should see only the modules it uses.

## 252.5 Fine-Grained Permissions

Especially protect:

- Purchase cost
- Profit
- Banking
- Historical edits
- Discounts
- Price overrides

## 252.6 Better Document Conversion

Natural workflow:

```text
Quotation
→ Order
→ Delivery
→ Invoice
→ Payment
```

## 252.7 Offline-First

This must be designed from day one.

## 252.8 Proper Journal Accounting

Reports should derive from consistent accounting entries.

---

# 253. Mandatory Coding-Agent Instructions

The following rules should be treated as mandatory.

> Do not start by creating all UI screens. First design the domain model, local database, repository layer, synchronization strategy, tenant isolation, permission system, feature-flag system, theme engine, accounting journal, and stock ledger. UI screens must consume these systems instead of containing business logic.

> Do not hard-code business names, colors, tax names, currencies, invoice labels, payment types, transaction labels, modules, printer type, company logo, feature availability, or role permissions.

> Every core sales and inventory transaction must work locally without internet and synchronize when connectivity becomes available.

> Do not duplicate logic between sales, purchases, orders, quotations, and returns. Build reusable transaction components and domain services.

> Never use floating-point arithmetic for money.

> Every financial or stock-changing action must be auditable.

> Backend authorization must enforce tenant and role access. Frontend visibility alone is not security.

> Do not silently overwrite conflicting edits from multiple devices.

> Build module boundaries so optional modules can be disabled without breaking the rest of the app.

> Use reusable UI components and one central design system.

> The same source code must be capable of generating multiple white-label brands.

---

# 254. Suggested Project Structure

One possible Android structure:

```text
app/
  core/
    auth/
    database/
    network/
    sync/
    security/
    theme/
    permissions/
    config/
    ui/
    utilities/

  domain/
    business/
    party/
    item/
    inventory/
    sales/
    purchase/
    payment/
    accounting/
    reporting/
    printing/
    notification/

  feature/
    dashboard/
    parties/
    items/
    stock/
    quotations/
    orders/
    invoices/
    purchases/
    payments/
    expenses/
    reports/
    settings/
    users/
    backup/
    syncstatus/

  data/
    local/
    remote/
    repository/

  whiteLabel/
    branding/
    capabilities/
    deployment/
```

Backend structure should similarly separate:

```text
auth
tenants
businesses
users
roles
parties
items
inventory
orders
sales
purchases
payments
accounting
reports
files
notifications
sync
subscriptions
white-label
```

---

# 255. Definition of Done

A module should not be considered complete merely because a screen exists.

For each feature verify:

- UI works
- Data saves locally
- Validation works
- Permissions work
- Offline mode works
- Sync works
- Audit logging works
- Reports reflect it
- Printing/sharing works where relevant
- Error states are handled
- Loading states exist
- Empty states exist
- Accessibility is acceptable
- Tablet layout is acceptable
- Small-phone layout is acceptable
- Dark mode works
- Localization does not break layout

---

# 256. Testing Requirements

Testing must include:

## Unit Tests

For:

- Price calculations
- Tax
- Discount
- Totals
- Stock movement
- Accounting entries
- Permissions
- Sync conflict rules

## Database Tests

For:

- Ledger consistency
- Migrations
- Offline transactions
- Soft delete
- Restore

## UI Tests

For:

- Creating customer
- Creating product
- Taking order
- Converting order to invoice
- Receiving payment
- Purchase entry
- Printing
- Role restrictions

## Integration Tests

For:

- Offline → Online sync
- Multi-device conflict
- Backup/restore
- Notification flow
- Printer integration

---

# 257. Final Product Goal

The finished application should feel simple to a small shop owner while remaining powerful enough for:

- Distributor businesses
- Multi-user teams
- Multi-branch companies
- Field sales
- Warehousing
- Accounting
- Counter billing
- Dealer ordering
- Online catalog/order capture

The core rule is:

```text
Simple UI
+
Configurable Features
+
Strong Data Model
+
Offline Reliability
+
White-Label Flexibility
```

This document should be used as the master product specification for the VS Code coding agent.
