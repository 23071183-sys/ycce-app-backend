// Tables and columns for the features added in the redesign. Run at startup
// after the original auto-migrate block. Each feature is its own statement
// batch, so one failing (and being logged) never stops the others from being
// created. Everything is IF NOT EXISTS, so running it on every boot is safe.
//
// Money is stored as whole paise (integers), never as decimals.

const FEATURES = [
  {
    name: 'profile',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL
        DEFAULT '{"announcements":true,"lectures":true,"deadlines":true,"messages":true,"fees":true,"placements":true,"events":true}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token VARCHAR(64);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_users_calendar_token ON users(calendar_token) WHERE calendar_token IS NOT NULL;
    `,
  },
  {
    name: 'messaging',
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('student_professor','student_admin')),
        pair_key VARCHAR(40) NOT NULL UNIQUE,
        subject_id INT REFERENCES subjects(id) ON DELETE SET NULL,
        created_by INT NOT NULL REFERENCES users(id),
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_message_preview TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_message_id BIGINT NOT NULL DEFAULT 0,
        muted BOOLEAN NOT NULL DEFAULT false,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cp_user ON conversation_participants(user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INT NOT NULL REFERENCES users(id),
        body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
        client_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        UNIQUE (sender_id, client_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id);
    `,
  },
  {
    name: 'fees',
    sql: `
      CREATE TABLE IF NOT EXISTS fee_structures (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        academic_year VARCHAR(20) NOT NULL,
        year INT NOT NULL CHECK (year BETWEEN 1 AND 4),
        semester INT,
        department VARCHAR(100) DEFAULT 'Computer Technology',
        due_date DATE NOT NULL,
        late_fee_paise INT NOT NULL DEFAULT 0 CHECK (late_fee_paise >= 0),
        is_active BOOLEAN NOT NULL DEFAULT true,
        published_at TIMESTAMPTZ,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS fee_structure_items (
        id SERIAL PRIMARY KEY,
        structure_id INT NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
        label VARCHAR(120) NOT NULL,
        amount_paise INT NOT NULL CHECK (amount_paise >= 0)
      );
      CREATE TABLE IF NOT EXISTS fee_invoices (
        id SERIAL PRIMARY KEY,
        structure_id INT NOT NULL REFERENCES fee_structures(id),
        student_id INT NOT NULL REFERENCES users(id),
        amount_due_paise INT NOT NULL CHECK (amount_due_paise >= 0),
        amount_paid_paise INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
          CHECK (status IN ('unpaid','partial','paid','waived','cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (structure_id, student_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fee_invoices_student ON fee_invoices(student_id);
      ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS late_fee_applied BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS waive_note TEXT;
      CREATE SEQUENCE IF NOT EXISTS fee_receipt_seq;
      CREATE TABLE IF NOT EXISTS fee_payments (
        id SERIAL PRIMARY KEY,
        invoice_id INT NOT NULL REFERENCES fee_invoices(id),
        student_id INT NOT NULL REFERENCES users(id),
        amount_paise INT NOT NULL CHECK (amount_paise > 0),
        method VARCHAR(20) NOT NULL DEFAULT 'razorpay'
          CHECK (method IN ('razorpay','cash','cheque','waiver')),
        status VARCHAR(20) NOT NULL DEFAULT 'created'
          CHECK (status IN ('created','pending','captured','failed','expired','cancelled','refunded')),
        razorpay_payment_link_id VARCHAR(64) UNIQUE,
        razorpay_payment_id VARCHAR(64) UNIQUE,
        short_url TEXT,
        link_expires_at TIMESTAMPTZ,
        receipt_no VARCHAR(40) UNIQUE,
        note TEXT,
        recorded_by INT REFERENCES users(id),
        raw_event JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fee_payments_invoice ON fee_payments(invoice_id);
      CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
        event_id VARCHAR(64) PRIMARY KEY,
        event VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        payload JSONB NOT NULL
      );
    `,
  },
  {
    name: 'placements',
    sql: `
      CREATE TABLE IF NOT EXISTS placement_drives (
        id SERIAL PRIMARY KEY,
        company VARCHAR(160) NOT NULL,
        role VARCHAR(160) NOT NULL,
        package_lpa NUMERIC(6,2),
        location VARCHAR(160),
        eligibility_cgpa NUMERIC(4,2),
        branches TEXT[] NOT NULL DEFAULT '{}',
        description TEXT,
        apply_url TEXT,
        apply_deadline DATE,
        drive_date DATE,
        end_date DATE,
        rounds JSONB NOT NULL DEFAULT '[]',
        status_override VARCHAR(12) CHECK (status_override IN ('upcoming','ongoing','finished')),
        selected_count INT,
        selected_names TEXT,
        outcome_notes TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: 'event-registrations',
    sql: `
      ALTER TABLE fest_events ADD COLUMN IF NOT EXISTS capacity INT CHECK (capacity IS NULL OR capacity > 0);
      ALTER TABLE compufest_events ADD COLUMN IF NOT EXISTS capacity INT CHECK (capacity IS NULL OR capacity > 0);
      CREATE TABLE IF NOT EXISTS event_registrations (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(12) NOT NULL CHECK (event_type IN ('fest','compufest')),
        event_id INT NOT NULL,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticket_code VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(12) NOT NULL DEFAULT 'registered'
          CHECK (status IN ('registered','checked_in','cancelled')),
        checked_in_at TIMESTAMPTZ,
        checked_in_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (event_type, event_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_event_reg_event ON event_registrations(event_type, event_id);
    `,
  },
  {
    // Marking attendance upserts ON CONFLICT (student_id, subject_id, date),
    // which needs this index; without it every mark failed.
    name: 'attendance-unique',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_subject_date
            ON attendance (student_id, subject_id, date);`,
  },
  {
    name: 'qr-attendance',
    sql: `
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id),
        professor_id INT NOT NULL REFERENCES users(id),
        date DATE NOT NULL,
        secret VARCHAR(64) NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at TIMESTAMPTZ,
        geofence JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_att_sessions_subject ON attendance_sessions(subject_id, date);
      CREATE TABLE IF NOT EXISTS attendance_session_scans (
        session_id INT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        student_id INT NOT NULL REFERENCES users(id),
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, student_id)
      );
    `,
  },
  {
    name: 'study',
    sql: `
      CREATE TABLE IF NOT EXISTS exam_schedule (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        exam_type VARCHAR(10) NOT NULL CHECK (exam_type IN ('MSE1','MSE2','RE_MSE','ESE')),
        exam_date DATE NOT NULL,
        start_time TIME,
        room VARCHAR(60),
        academic_year VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (subject_id, exam_type, academic_year)
      );
      CREATE TABLE IF NOT EXISTS question_papers (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        exam_type VARCHAR(10) NOT NULL CHECK (exam_type IN ('MSE1','MSE2','RE_MSE','ESE')),
        academic_year VARCHAR(20),
        file_url TEXT NOT NULL,
        file_name TEXT,
        uploaded_by INT REFERENCES users(id),
        extract_status VARCHAR(12) NOT NULL DEFAULT 'pending'
          CHECK (extract_status IN ('pending','processing','done','failed')),
        extract_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS question_bank (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        paper_id INT REFERENCES question_papers(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        marks NUMERIC(5,2),
        topic VARCHAR(160),
        source VARCHAR(10) NOT NULL DEFAULT 'paper' CHECK (source IN ('paper','notes'))
      );
      CREATE INDEX IF NOT EXISTS idx_qbank_subject ON question_bank(subject_id);
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        questions JSONB NOT NULL,
        source_hash VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id SERIAL PRIMARY KEY,
        quiz_id INT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        student_id INT NOT NULL REFERENCES users(id),
        answers JSONB NOT NULL,
        score INT NOT NULL,
        total INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS flashcards (
        id SERIAL PRIMARY KEY,
        subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        topic VARCHAR(160),
        source_hash VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS flashcard_reviews (
        card_id INT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
        student_id INT NOT NULL REFERENCES users(id),
        ease NUMERIC(4,2) NOT NULL DEFAULT 2.5,
        interval_days INT NOT NULL DEFAULT 0,
        repetitions INT NOT NULL DEFAULT 0,
        due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_reviewed_at TIMESTAMPTZ,
        PRIMARY KEY (card_id, student_id)
      );
      CREATE TABLE IF NOT EXISTS study_reviews_log (
        student_id INT NOT NULL REFERENCES users(id),
        review_date DATE NOT NULL,
        PRIMARY KEY (student_id, review_date)
      );
      CREATE TABLE IF NOT EXISTS study_plans (
        id SERIAL PRIMARY KEY,
        student_id INT NOT NULL REFERENCES users(id),
        plan JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    // Small app-wide switches admins can flip without a redeploy (e.g. AI provider).
    name: 'app-settings',
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(60) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_by INT REFERENCES users(id),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: 'badges',
    sql: `
      CREATE TABLE IF NOT EXISTS user_badges (
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge VARCHAR(40) NOT NULL,
        earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, badge)
      );
    `,
  },
];

async function migrateFeatures(client) {
  for (const feature of FEATURES) {
    try {
      await client.query(feature.sql);
    } catch (e) {
      console.error(`Auto-migrate (${feature.name}) error:`, e.message);
    }
  }
}

module.exports = { migrateFeatures, FEATURES };
