node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

membuat sessions 

node -e "console.log(require('bcryptjs').hashSync('GANTI_PASSWORD_KAMU', 12))"

membuat password admin