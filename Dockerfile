FROM node:21-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# Install dependencies
RUN yarn install

# Copy CSV files into container
COPY data/eager/*.csv ./data/eager/
COPY data/sarek/*.csv ./data/sarek/

# Bundle app source
COPY . .

# Container port
EXPOSE 3000

# Start command
CMD [ "yarn", "start" ]
