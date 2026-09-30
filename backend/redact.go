package main

// redactConnection returns a copy safe to send in list responses: the database
// password and the SSH credentials are removed. The full record is only handed
// out by getConnection when the client explicitly opens a connection for
// editing.
func redactConnection(c Connection) Connection {
	out := c
	if out.Password != "" {
		out.Password = ""
	}
	if c.SSH != nil {
		ssh := *c.SSH
		ssh.Password = ""
		ssh.PrivateKey = ""
		ssh.Passphrase = ""
		out.SSH = &ssh
	}
	return out
}
