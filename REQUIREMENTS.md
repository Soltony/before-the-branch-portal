
# LoanFlow - Software Requirements Specification

**Version:** 1.0
**Date:** October 23, 2025

---

## 1. Introduction

### 1.1 Purpose
This document provides a detailed specification of the software requirements for **LoanFlow**, a multi-provider micro-credit platform. It is designed to serve as a comprehensive guide for development, testing, and project management. The platform facilitates the entire loan lifecycle, from provider configuration and borrower application to automated repayment and system auditing.

### 1.2 Scope
The scope of this project covers the development of a web-based application with two primary interfaces:
1.  An **Admin Dashboard** for platform administrators and loan providers to manage the system, configure products, and monitor financial activities.
2.  A **Borrower-Facing Application** for end-users to check eligibility, apply for loans, and manage their repayments.

The system includes automated backend services for processing repayments and flagging non-performing loans (NPLs).

### 1.3 System Overview
LoanFlow is a modern web application built on the Next.js framework with a React front-end. It uses Prisma as the ORM to interact with a SQL Server database. The backend is composed of Next.js API routes and server actions. The system is designed to be deployed on a NodeJS-compatible hosting environment.

---

## 2. Overall Description

### 2.1 Product Perspective
LoanFlow is a self-contained platform that serves as a bridge between micro-credit providers and borrowers. It allows providers to digitize their loan products and risk assessment processes, while offering borrowers a streamlined, accessible way to secure financing.

### 2.2 Key User Roles (Actors)
The system is designed to be used by the following key actors:

*   **Super Admin:** Has unrestricted access to all system functionalities, including user management, provider setup, and system-wide settings.
*   **Loan Provider (Admin):** Manages their own portfolio, including creating loan products, defining scoring rules, and viewing provider-specific reports. Has limited access compared to the Super Admin.
*   **Borrower:** The end-user who applies for and repays loans. Interacts with the public-facing application.
*   **System:** Represents automated processes, such as background workers for NPL checks and automated repayments.

### 2.3 General Constraints
*   The application is built using the Next.js framework with React, Tailwind CSS, and ShadCN UI components. The technology stack is fixed.
*   The database interaction is managed exclusively through Prisma ORM.
*   The system must handle financial calculations with precision, particularly regarding interest, fees, and penalties.

---

## 3. Functional Requirements

### 3.1 FR-1: User Management and Access Control

*   **FR-1.1: Role-Based Access Control (RBAC):** The system shall implement a granular RBAC system.
    *   Admins can create, view, update, and delete roles.
    *   Each role defines a set of permissions (Create, Read, Update, Delete) for each major system module (e.g., Dashboard, Reports, Settings).
    *   A role cannot be deleted if it is assigned to any user.

*   **FR-1.2: User Administration:**
    *   Admins with appropriate permissions can create, view, and update user accounts.
    *   User accounts shall include `fullName`, `email`, `phoneNumber`, `password` (hashed), `role`, `status` (Active/Inactive), and an optional link to a `LoanProvider`.
    *   User passwords shall be securely hashed using `bcryptjs`.
    *   User status can be toggled between 'Active' and 'Inactive' to manage access.

*   **FR-1.3: User Authentication:**
    *   Users shall be able to log in using their phone number and password.
    *   The system shall support session management via encrypted JWTs stored in cookies.
    *   The system shall provide a secure logout mechanism that deletes the session.

### 3.2 FR-2: Provider and Product Management

*   **FR-2.1: Loan Provider Management:**
    *   Super Admins can create, view, update, and delete `LoanProvider` entities.
    *   Each provider shall have a name, icon, brand color, account number, and initial capital.
    *   A provider cannot be deleted if it has active loan products.

*   **FR-2.2: Loan Product Management:**
    *   Provider admins can create, view, update, and delete `LoanProduct` entities for their own institution.
    *   Each product shall define:
        *   `minLoan` and `maxLoan` amounts.
        *   `duration` in days.
        *   `serviceFee` (fixed or percentage).
        *   `dailyFee` (interest, fixed or percentage of principal/compound).
        *   `penaltyRules` (tiered penalties based on days overdue).
        *   Flags to enable/disable fees and penalties.
        *   A flag to allow or disallow concurrent loans.

### 3.3 FR-3: Credit Scoring Engine

*   **FR-3.1: Data Provisioning:**
    *   Admins can define data schemas (`DataProvisioningConfig`) for uploading borrower data (e.g., credit history, income).
    *   Schemas define columns, data types (string, number, date), and a unique identifier.
    *   Admins can upload borrower data via XLSX files, which is then parsed and stored.

*   **FR-3.2: Scoring Rule Definition:**
    *   Provider admins can define a weighted credit scoring model.
    *   The model consists of `ScoringParameters` (e.g., "Income", "Employment Status") with assigned weights.
    *   Each parameter contains one or more `Rules` that assign points based on conditions (e.g., `IF 'Employment Status' == 'Employed' THEN score 100`).
    *   The system supports logical conditions: `>`, `<`, `>=`, `<=`, `==`, `!=`, and `between`.

*   **FR-3.3: Loan Amount Tiers:**
    *   For each loan product, admins can define `LoanAmountTiers`.
    *   Each tier maps a credit score range to a maximum loan amount (e.g., Score 501-700 -> Max Loan 25,000).

*   **FR-3.4: Scoring Preview:**
    *   The admin interface shall provide a tool to preview the score calculation by inputting sample borrower data against the defined rules.

### 3.4 FR-4: Loan Lifecycle Management

*   **FR-4.1: Borrower Eligibility Check:**
    *   A borrower's eligibility is checked against a specific provider's scoring model.
    *   The system calculates a credit score based on the borrower's provisioned data and internal repayment history (`repaymentBehavior`).
    *   The system determines the `maxLoanAmount` based on the applicable loan tier and any outstanding principal.
    *   Eligibility is denied if the borrower has an active loan of a non-concurrent type or is flagged as 'NPL'.

*   **FR-4.2: Loan Application & Disbursement:**
    *   Borrowers can select a product and use a calculator to see the total repayable amount.
    *   Upon acceptance, a `LoanApplication` is created, and for personal loans, the status is immediately set to `DISBURSED`.
    *   The system creates a `Loan` record, linking it to the application, and updates the provider's balance.

*   **FR-4.3: Loan Repayment:**
    *   Borrowers can make full or partial repayments against their active loans.
    *   Payments are prioritized: penalties, then service fees, then interest, and finally principal.
    *   The system supports external payment gateway integration. A `PendingPayment` record is created to track the intent, and a callback handler processes the final transaction.

*   **FR-4.4: Automated Background Services:**
    *   **NPL Flagging:** A scheduled worker (`worker.ts`) identifies loans overdue beyond the provider's `nplThresholdDays` and updates the borrower's status to 'NPL'.
    *   **Automated Repayment:** A scheduled service attempts to deduct payments for overdue loans from a simulated borrower account balance (sourced from provisioned data).

### 3.5 FR-5: Accounting and Reporting

*   **FR-5.1: Double-Entry Ledger System:**
    *   Each provider has a set of `LedgerAccounts` (e.g., Principal Receivable, Interest Income).
    *   All financial transactions (disbursements, repayments, fee accrual) must generate a `JournalEntry` with corresponding debit and credit `LedgerEntry` records.

*   **FR-5.2: Admin Dashboard:**
    *   The dashboard shall display key performance indicators (KPIs) in real-time using SignalR.
    *   Metrics include: daily disbursement, daily repayments, total loans, at-risk loans, provider fund status, and total income.
    *   Super Admins can view data aggregated across all providers or filter by a specific provider.

*   **FR-5.3: Reporting Suite:**
    *   The system shall generate exportable (XLSX) reports for:
        *   **Provider Loans:** Detailed breakdown of all loans, including outstanding amounts.
        *   **Collections:** All funds received, categorized by type (principal, interest, etc.).
        *   **Income Statement:** Accrued vs. collected income.
        *   **Fund Utilization:** Capital deployed vs. available.
        *   **Aging Report:** Bucketed list of overdue loans (1-30, 31-60, 61-90, 91+ days).
        *   **Borrower Performance:** Individual borrower loan status and arrears.

*   **FR-5.4: Audit Logging:**
    *   The system must log all critical user and system actions in an `AuditLog` table.
    *   Logged events include user logins (success/failure), role/user/product creation/updates/deletions, loan disbursements, and repayments.
    *   Logs must include the actor, action, timestamp, IP address, and a JSON object with relevant details.

---

## 4. Non-Functional Requirements

### 4.1 NFR-1: Security
*   **NFR-1.1:** All user passwords must be hashed before storage.
*   **NFR-1.2:** Sessions shall be managed via secure, `httpOnly` cookies with an expiration time.
*   **NFR-1.3:** Middleware shall be implemented to protect all admin routes from unauthorized access.
*   **NFR-1.4:** The application shall implement a Content Security Policy (CSP) to mitigate cross-site scripting (XSS) attacks.

### 4.2 NFR-2: Performance
*   **NFR-2.1:** Database queries should be optimized. Backend data fetching for reports and dashboards must be performant.
*   **NFR-2.2:** The user interface should be responsive, with loading indicators for any operation that takes more than 500ms.
*   **NFR-2.3:** Real-time dashboard updates must be handled efficiently via SignalR without causing significant client-side performance degradation.

### 4.3 NFR-3: Usability
*   **NFR-3.1:** The user interfaces for both admin and borrower flows must be intuitive and easy to navigate.
*   **NFR-3.2:** Error messages must be clear, user-friendly, and provide actionable information where possible.
*   **NFR-3.3:** The application must be fully responsive and functional on modern web browsers on both desktop and mobile devices.

### 4.4 NFR-4: Reliability
*   **NFR-4.1:** The system shall use database transactions for all multi-step financial operations (e.g., loan disbursement, repayment) to ensure data integrity.
*   **NFR-4.2:** The background worker processes must be resilient and include error handling to prevent crashes from a single failed task.
*   **NFR-43:** The payment gateway callback handler must be idempotent, preventing duplicate processing of the same transaction.

---
