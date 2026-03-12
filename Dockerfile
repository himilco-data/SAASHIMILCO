# Utiliser une image Node.js légère
FROM node:20-alpine

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier tout le reste du code
COPY . .

# Construire l'application
RUN npm run build

# Exposer le port 3000
EXPOSE 3000

# Lancer l'application
CMD ["npm", "start"]
