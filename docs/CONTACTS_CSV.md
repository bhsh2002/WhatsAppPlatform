# Contacts CSV import and export

Both the administrator contacts screen and the tenant portal can export the
currently filtered contacts and import a UTF-8 CSV file. The administrator must
select one tenant before importing; the tenant portal always uses the tenant in
the authenticated session. A row can never select or override its own tenant.

## Supported columns

The first row must contain a phone column. Column names are case-insensitive and
spaces or hyphens are treated like underscores.

| Field | Accepted headers | Required | Limit |
|---|---|---:|---:|
| Phone | `phone`, `phone_number`, `mobile`, `الهاتف`, `رقم الهاتف` | Yes | 7–15 digits after normalization |
| Name | `profile_name`, `name`, `contact_name`, `الاسم`, `اسم جهة الاتصال` | No | 200 characters |
| Label | `label`, `tag`, `التصنيف` | No | 64 characters |
| Notes | `notes`, `note`, `الملاحظات` | No | 2,000 characters |

Unknown columns are ignored. Quoted commas, escaped quotes, and line breaks
inside quoted fields are supported. Files are limited to 10,000 data rows and
must pass the platform's CSV content validation before parsing.

Example:

```csv
phone,profile_name,label,notes
218912345678,عميل تجريبي,مهم,"يفضل التواصل صباحاً"
218923456789,شركة المثال,متابعة,"طلب عرض سعر"
```

## Import behavior

- Phone numbers are normalized using the same validation as manual contacts.
- Duplicate phone numbers inside one file are rejected and reported by row.
- A new phone creates a contact inside the selected tenant.
- An existing phone updates the non-empty name, label, and notes fields.
- Empty optional cells preserve existing values during an update.
- Valid rows are imported even when other rows fail; the response reports
  created, updated, and failed counts plus at most 50 row errors.
- The whole database upsert runs in one transaction.

## Export behavior

- Export applies the current search, label, and tenant filters.
- Tenant exports never include another tenant's contacts.
- Administrator exports include tenant ID and tenant name for context.
- The file is UTF-8 with a BOM so Arabic text opens correctly in spreadsheet
  applications.
- Values beginning with spreadsheet formula characters are neutralized before
  export to prevent formula execution when the file is opened.
