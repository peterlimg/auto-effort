import billing, invoice
assert hasattr(billing, "calculate_total") and not hasattr(billing, "calc")
assert billing.calculate_total([(2.0, 3)]) == 6.0
assert invoice.invoice_total([(10.0, 1)]) == 11.0
