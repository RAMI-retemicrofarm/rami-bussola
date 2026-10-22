# La copia di sicurezza

Ogni notte una copia cifrata della cartella «Bussola», fuori da Google: rclone la legge con un service account in
sola lettura, la cifra con `rclone crypt` e la scrive su Backblaze B2. Il workflow pianificato gira in un repo privato
a parte, `rami-bussola-copia`.

Qui arriveranno i modelli della configurazione di rclone e del workflow. Si accende solo dopo l'ok di chi cura lo
spazio Backblaze di RAMI.
