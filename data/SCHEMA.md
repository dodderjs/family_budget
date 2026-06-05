"""
DATABASE SCHEMA

This file documents the database schema used by the Family Budget application.
"""

-- Accounts
CREATE TABLE accounts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  bank_name VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions
CREATE TABLE transactions (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL FOREIGN KEY REFERENCES accounts(id),
  date VARCHAR(10) NOT NULL,
  amount FLOAT NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  description VARCHAR(500) NOT NULL,
  merchant VARCHAR(255),
  raw_source TEXT,
  hash_fingerprint VARCHAR(64) UNIQUE NOT NULL,
  category_predicted VARCHAR(50),
  category_confidence FLOAT,
  category_final VARCHAR(50),
  is_transfer BOOLEAN DEFAULT FALSE,
  transfer_match_id VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Categories
CREATE TABLE categories (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Training Data
CREATE TABLE training_data (
  id VARCHAR(36) PRIMARY KEY,
  transaction_id VARCHAR(36) NOT NULL FOREIGN KEY REFERENCES transactions(id),
  original_label VARCHAR(50) NOT NULL,
  corrected_label VARCHAR(50) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
