CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`barcode` text NOT NULL,
	`receipt_number` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_barcode_unique` ON `receipts` (`barcode`);