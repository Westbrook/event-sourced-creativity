These SQL files are byte-for-byte copies of Forma's assistant migrations 0020
and 0021 from commit `cb5e90c`. They reproduce the existing-table and repeated
ADD COLUMN cases in checkouts that do not yet include the assistant migrations.
The fixture journal renumbers their positions to start at zero; original tags
and timestamps are retained. Tests use the real migrations when available.
