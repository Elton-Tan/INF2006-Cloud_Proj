#!/usr/bin/env python3
"""
Clean the ShoppingPreferences.csv by removing irrelevant columns (electronics and fashion platforms).
Keep only columns relevant to skincare/dermatology business.
"""

import csv
from pathlib import Path

input_file = Path("public/data/ShoppingPreferences.csv")
output_file = Path("public/data/ShoppingPreferences_cleaned.csv")

# Read the original CSV
with open(input_file, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    rows = list(reader)

# Process: Remove columns 4 and 5 (index 3 and 4 - electronics and fashion)
# Keep: 0=Timestamp, 1=Shopping Frequency, 2=Age Group,
#       5=Beauty/Skincare Platform (becomes new col 3)
#       6=Groceries (becomes new col 4)
#       7=Important Factor (becomes new col 5)
#       8=Trust Level (becomes new col 6)
#       9=Return Policy (becomes new col 7)

cleaned_rows = []
for row in rows:
    if len(row) >= 10:
        # Keep columns: 0, 1, 2, 5, 6, 7, 8, 9 (skip 3 and 4)
        cleaned_row = [
            row[0],  # Timestamp
            row[1],  # Shopping Frequency
            row[2],  # Age Group
            row[5],  # Beauty/Skincare Platform (column 5)
            row[6],  # Groceries Platform (column 6)
            row[7],  # Important Factor
            row[8],  # Trust Level
            row[9],  # Return Policy
        ]
        cleaned_rows.append(cleaned_row)

# Update header
if cleaned_rows:
    cleaned_rows[0] = [
        "Timestamp",
        "Shopping Frequency",
        "Age Group",
        "Skincare Platform",
        "Grocery Platform",
        "Important Factor",
        "Trust Level",
        "Return Policy Preference"
    ]

# Write cleaned CSV
with open(output_file, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(cleaned_rows)

print(f"✅ Cleaned CSV created: {output_file}")
print(f"   Original rows: {len(rows)}")
print(f"   Cleaned rows: {len(cleaned_rows)}")
print(f"   Removed columns: 3 (Electronics Platform), 4 (Fashion Platform)")

# Preview first few rows
print("\n📊 Preview of cleaned data:")
for i, row in enumerate(cleaned_rows[:3]):
    print(f"Row {i}: {row}")
