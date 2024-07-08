import { Pool, QueryResult } from 'pg';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';
import { User } from 'app/lib/definitions';

const pool = new Pool({
  user: 'user', // PostgreSQL username
  host: 'localhost', // Docker container host
  database: 'dashboard_db', // Database name
  password: 'password', // PostgreSQL password
  port: 5432, // PostgreSQL port
});

export async function insertInvoice(customerId: string, amountInCents: number, status: 'pending' | 'paid', date: string) {
  const client = await pool.connect();
  try{
    const query = `
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES ($1, $2, $3, $4)
    `;
    const values = [customerId, amountInCents, status, date];

    await client.query(query, values);
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to insert the invoice.');
  } finally {
    client.release(); 
  }
}

export async function updateInvoiceData(customerId: string, amountInCents: number, status: 'pending' | 'paid', id: string) {
  const client = await pool.connect();
  try{
    const query = `
      UPDATE invoices
      SET customer_id = $1, amount = $2, status = $3
      WHERE id = $4
    `;

    const values = [customerId, amountInCents, status, id];

    await client.query(query, values);
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to edit the invoice.');
  } finally {
    client.release();
  }
}

export async function deleteInvoiceData(id: string) {
  const client = await pool.connect();
  try{
    const query = `
      DELETE FROM invoices WHERE id = $1
    `;

    const values = [id];

    await client.query(query, values);
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to delete the invoice.');
  } finally {
    client.release();
  }
}

export async function fetchRevenue() {
  const client = await pool.connect(); 
  try {
    // Artificially delay a response for demo purposes.
    // Don't do this in production :)

    console.log('Fetching revenue data...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const data: QueryResult<Revenue> = await client.query('SELECT * FROM revenue');

    console.log('Data fetch completed after 3 seconds.');

    return data.rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  } finally {
    client.release();
  }
}

export async function fetchLatestInvoices() {
  const client = await pool.connect();
  try {
    const data: QueryResult<LatestInvoiceRaw> = await client.query(`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5`);

    const latestInvoices = data.rows.map((invoice: LatestInvoiceRaw) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  } finally {
    client.release();
  }
}

export async function fetchCardData() {
  const client = await pool.connect();
  try {
    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const invoiceCountPromise = client.query(`SELECT COUNT(*) FROM invoices`);
    const customerCountPromise = client.query(`SELECT COUNT(*) FROM customers`);
    const invoiceStatusPromise = client.query(`SELECT
         SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
         SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
         FROM invoices`);

    const data = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(data[0].rows[0].count ?? '0');
    const numberOfCustomers = Number(data[1].rows[0].count ?? '0');
    const totalPaidInvoices = formatCurrency(data[2].rows[0].paid ?? '0');
    const totalPendingInvoices = formatCurrency(data[2].rows[0].pending ?? '0');

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  } finally {
    client.release();
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const client = await pool.connect();
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const queryText = `
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE $1 OR
        customers.email ILIKE $1 OR
        invoices.amount::text ILIKE $1 OR
        invoices.date::text ILIKE $1 OR
        invoices.status ILIKE $1
      ORDER BY invoices.date DESC
      LIMIT $2 OFFSET $3
    `;

    const values = [`%${query}%`, ITEMS_PER_PAGE, offset];
    const invoices: QueryResult<InvoicesTable> = await client.query(queryText, values);

    return invoices.rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  } finally {
    client.release();
  }
}

export async function fetchInvoicesPages(query: string) {
  const client = await pool.connect();
  try {
    const count = await client.query(
      `SELECT COUNT(*)
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE $1 OR
        customers.email ILIKE $1 OR
        invoices.amount::text ILIKE $1 OR
        invoices.date::text ILIKE $1 OR
        invoices.status ILIKE $1`,
      [`%${query}%`]
    );

    const totalPages = Math.ceil(Number(count.rows[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  } finally {
    client.release();
  }
}

export async function fetchInvoiceById(id: string) {
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = $1;
    `;
    const values = [id];
    const data: QueryResult<InvoiceForm> = await client.query(query, values);

    const invoice = data.rows.map((invoice: any) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  } finally {
    client.release();
  }
}

export async function fetchCustomers() {
  const client = await pool.connect();
  try {
    const data: QueryResult<CustomerField> = await client.query(`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `);

    const customers = data.rows;
    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  } finally {
    client.release();
  }
}

export async function fetchFilteredCustomers(query: string) {
  const client = await pool.connect();
  try {
    const sql =`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE $1 OR
      customers.email ILIKE $1
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const values = [`%${query}%`];

    const data: QueryResult<CustomersTableType> = await client.query(sql, values);

    const customers = data.rows.map((customer: any) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    console.log(customers);
    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  } finally {
    client.release();
  }
}

export async function getUser(email: string): Promise<User | undefined> {
  const client = await pool.connect();

  try {
    const query = await 'SELECT * FROM users WHERE email=$1';
    const values = [email];
    const user = await client.query(query, values);
    return user.rows[0];
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  } finally {
    client.release();
  }
}
